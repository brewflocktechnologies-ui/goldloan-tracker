'use strict';
/**
 * UI test fixtures.
 *
 * Each test gets its own fresh in-memory "spreadsheet" running the real code.js, and a
 * browser page that loads the real index.html. A small shim stands in for Google's
 * `google.script.run` and forwards calls to that backend, exactly the way Apps Script
 * would: only functions without a trailing "_" are callable, anything else is
 * "not a function" in the page.
 *
 *   test('...', async ({ app }) => {
 *     app.backend.seed.user();          // put data in the sheet first (fast)
 *     await app.open();                 // load the page
 *     await app.login();                // sign in through the real login form
 *     ...drive the UI with app.page...
 *   });
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const base = require('@playwright/test');
const { loadBackend, plain } = require('../tests/helpers/backend');

const ORIGIN = 'http://goldloan.test';
const CDN_CACHE = path.join(__dirname, '..', '.cache', 'cdn');
const CDN_HOSTS = /^https:\/\/(cdn\.tailwindcss\.com|cdn\.jsdelivr\.net)\//;

/** Serve third-party scripts from a disk cache so the suite also runs offline after the first run. */
async function installCdnCache(page) {
  fs.mkdirSync(CDN_CACHE, { recursive: true });
  await page.route(CDN_HOSTS, async route => {
    const url = route.request().url();
    const key = path.join(CDN_CACHE, crypto.createHash('sha1').update(url).digest('hex'));
    if (fs.existsSync(key + '.json')) {
      const { contentType } = JSON.parse(fs.readFileSync(key + '.json', 'utf8'));
      return route.fulfill({ status: 200, contentType, body: fs.readFileSync(key + '.body') });
    }
    const response = await route.fetch();
    const body = await response.body();
    if (response.ok()) {
      fs.writeFileSync(key + '.body', body);
      fs.writeFileSync(key + '.json', JSON.stringify({ url, contentType: response.headers()['content-type'] || 'application/javascript' }));
    }
    return route.fulfill({ response, body });
  });
  // Web fonts are cosmetic; skip them so tests never wait on Google Fonts.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
}

/** Replace google.script.run with a bridge to the in-memory backend. */
async function installGoogleShim(page, backend) {
  const publicFns = [...backend.readSource().matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/gm)]
    .map(m => m[1]).filter(n => !n.endsWith('_'));

  await page.exposeFunction('__gas', async (name, args) => {
    try {
      return { ok: true, value: plain(backend.ctx[name](...args)) };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });

  await page.addInitScript(({ publicFns }) => {
    const make = (onSuccess, onFailure) => new Proxy({}, {
      get(_target, prop) {
        if (prop === 'withSuccessHandler') return fn => make(fn, onFailure);
        if (prop === 'withFailureHandler') return fn => make(onSuccess, fn);
        if (prop === 'withUserObject') return () => make(onSuccess, onFailure);
        if (typeof prop !== 'string' || !publicFns.includes(prop)) return undefined; // "is not a function", like real Apps Script
        return (...args) => {
          window.__gas(prop, JSON.parse(JSON.stringify(args))).then(r => {
            if (r.ok) { if (onSuccess) onSuccess(r.value); }
            else if (onFailure) onFailure({ message: r.message });
            else console.error(r.message);
          });
        };
      },
    });
    window.google = { script: { run: make(null, null) } };
  }, { publicFns });
}

// A minimal copy of the gold-rate page the backend scrapes: 24K 9,850 / 22K 9,020 / 18K 7,380 per gram.
const GOLD_PAGE = `<html><body><table>
  <thead><tr><th>Gram</th><th>24K Gold</th><th>22K Gold</th><th>18K Gold</th></tr></thead>
  <tbody><tr><td>1 Gram</td>
    <td>₹9,850 <span class="gr-change gr-change-up">+50</span></td>
    <td>₹9,020 <span class="gr-change gr-change-down">-40</span></td>
    <td>₹7,380 <span class="gr-change">0</span></td></tr></tbody></table></body></html>`;

exports.expect = base.expect;
exports.RATES = { gold24k: 9850, gold22k: 9020, gold18k: 7380 };

exports.test = base.test.extend({
  app: async ({ page }, use) => {
    const backend = loadBackend();
    backend.fake.setFetch(() => { throw new Error('gold rate site unreachable (test)'); });

    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await installCdnCache(page);
    await installGoogleShim(page, backend);
    await page.route(ORIGIN + '/', route => route.fulfill({ status: 200, contentType: 'text/html', body: backend.readHtml() }));

    const app = {
      page,
      backend,
      pageErrors,
      open: () => page.goto(ORIGIN + '/'),

      /** Make the (fake) gold-rate website reachable with known prices; call before app.login(). */
      useGoldRates() {
        backend.fake.setFetch(() => ({ getResponseCode: () => 200, getContentText: () => GOLD_PAGE }));
      },

      /** Sign in through the real login form and wait for the dashboard. */
      async login(username = 'admin', password = 'password123') {
        await page.locator('#loginUsername').fill(username);
        await page.locator('#loginPassword').fill(password);
        await page.locator('#loginBtn').click();
        await base.expect(page.locator('#main-layout')).toBeVisible();
        await base.expect(page.locator('#view-login')).toBeHidden();
        await base.expect(page.locator('#view-dashboard')).toHaveClass(/active/);
      },

      /** Sign in as a read-only "User" (creates the account on first use). */
      async loginAsViewer() {
        backend.viewerToken();
        return app.login('viewer', 'viewer-pass');
      },

      /** Open a section from the sidebar, e.g. app.go('users'). */
      async go(section) {
        // the active nav item is deliberately click-proof (pointer-events: none), so only click when moving
        const alreadyThere = await page.locator(`#view-${section}`).evaluate(el => el.classList.contains('active'));
        if (!alreadyThere) await page.locator(`#nav-${section}`).click();
        await base.expect(page.locator(`#view-${section}`)).toHaveClass(/active/);
      },

      /** Rows of a table body, e.g. app.rows('usersTable'). */
      rows: tableId => page.locator(`#${tableId} tbody tr:not(.empty-pagination-row)`),

      /** The toast / dialog text SweetAlert is currently showing. */
      toast: () => page.locator('.swal2-popup'),

      sessionToken: () => page.evaluate(() => sessionStorage.getItem('goldLoanToken')),
    };

    await use(app);
  },
});
