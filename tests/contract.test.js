'use strict';
/**
 * Contract tests: the UI (index.html), the server (code.js) and the mobile app must
 * keep agreeing on action names, and nothing may leak to the browser by accident.
 * These catch the "renamed one side, forgot the other" class of break that is easy to
 * make in single-file apps.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadBackend, ROOT } = require('./helpers/backend');

const app = loadBackend({ bootstrap: false });
const src = app.readSource();
const html = app.readHtml();

const rpcActions = app.eval('Object.keys(RPC_ACTIONS_)');
const userRoleActions = app.eval('USER_ROLE_ACTIONS_');
const restCases = new Set([...src.matchAll(/case "([A-Za-z]+)":/g)].map(m => m[1]));
const quoted = text => [...text.matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]);

describe('server surface', () => {
  test('only the intended functions are callable from a browser (no trailing underscore)', () => {
    const publicFns = [...src.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/gm)].map(m => m[1]).filter(n => !n.endsWith('_'));
    assert.deepEqual(publicFns.sort(), [
      'authenticateAdmin', 'doGet', 'doPost', 'logoutAdmin', 'migrateAdminPasswordsToHashed', 'rpc', 'setupSheets', 'testGoldRates',
    ]);
  });

  test('every rpc action points at a real function', () => {
    assert.ok(rpcActions.length >= 30);
    assert.equal(app.eval('Object.values(RPC_ACTIONS_).every(f => typeof f === "function")'), true);
  });

  test('every action the read-only role may use is a real rpc action', () => {
    for (const a of userRoleActions) assert.ok(rpcActions.includes(a), a);
  });

  test('the REST handler and rpc agree on which actions the read-only role may use', () => {
    const block = src.match(/const USER_ALLOWED_ACTIONS = \[([\s\S]*?)\];/);
    assert.ok(block, 'USER_ALLOWED_ACTIONS list not found in handleApiRequest_');
    const restOnly = ['ping', 'testConnection', 'login', 'authenticateAdmin', 'logout', 'getSyncData'];
    const rest = [...block[1].matchAll(/"([A-Za-z]+)"/g)].map(m => m[1]).filter(a => !restOnly.includes(a));
    assert.deepEqual(rest.sort(), [...userRoleActions].sort());
  });

  test('every rpc action also exists in the REST handler (mobile app parity)', () => {
    for (const a of rpcActions) assert.ok(restCases.has(a), `REST handler has no case for "${a}"`);
  });

  test('a read-only User is refused (403) on every action outside their allow-list', () => {
    const tester = app2();
    const viewer = tester.api(tester.viewerToken());
    for (const a of rpcActions.filter(x => !userRoleActions.includes(x))) {
      assert.equal(viewer[a]().code, 403, a);
    }
  });

  test('a read-only User is not blocked by the role guard on their allowed actions', () => {
    const tester = app2();
    tester.fake.setFetch(() => { throw new Error('offline'); });
    const viewer = tester.api(tester.viewerToken());
    for (const a of userRoleActions) assert.notEqual(viewer[a]().code, 403, a);
  });

  test('an anonymous caller is refused (401) on every rpc action', () => {
    const tester = app2();
    for (const a of rpcActions) assert.equal(tester.rpc('', a, []).code, 401, a);
  });
});

describe('web UI (index.html) <-> server', () => {
  const uiActions = new Set();
  for (const m of html.matchAll(/gsr\(\s*'([A-Za-z]+)'/g)) uiActions.add(m[1]);
  for (const m of html.matchAll(/\.rpc\(\s*getSessionToken\(\)\s*,\s*'([A-Za-z]+)'/g)) uiActions.add(m[1]);
  // Actions picked at run time, e.g.  const fn = id ? 'updateUser' : 'addUser';  gsr(fn, ...)
  for (const m of html.matchAll(/const fn = ([^;]+);/g)) quoted(m[1]).forEach(a => uiActions.add(a));

  test('the extraction finds the UI\'s actions (guards this test itself)', () => {
    assert.ok(uiActions.size >= 25, `only found ${uiActions.size} actions: ${[...uiActions].join(', ')}`);
    for (const a of ['getUsers', 'addUser', 'updateUser', 'addLoan', 'updateLoan', 'closeAndReleaseLoan', 'getGoldRates']) {
      assert.ok(uiActions.has(a), a);
    }
  });

  test('every action the UI calls exists on the server', () => {
    const missing = [...uiActions].filter(a => !rpcActions.includes(a));
    assert.deepEqual(missing, []);
  });

  test('the UI never calls a server function directly; everything goes through rpc', () => {
    const direct = rpcActions.filter(a => new RegExp(`\\.${a}\\s*\\(`).test(html));
    assert.deepEqual(direct, []);
    // Right after google.script.run only the chaining helpers, rpc, or the two public auth calls may appear.
    const allowed = ['withSuccessHandler', 'withFailureHandler', 'withUserObject', 'rpc', 'authenticateAdmin', 'logoutAdmin'];
    for (const m of html.matchAll(/google\.script\.run\s*\.\s*([A-Za-z_]+)\s*\(/g)) {
      assert.ok(allowed.includes(m[1]), `direct google.script.run.${m[1]}()`);
    }
  });

  test('the only other server calls are login and logout', () => {
    assert.match(html, /\.authenticateAdmin\(user, pass\)/);
    assert.match(html, /google\.script\.run\.logoutAdmin\(token\)/);
  });

  test('the page\'s inline scripts are valid JavaScript', () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(scripts.length >= 2);
    scripts.forEach((code, i) => assert.doesNotThrow(() => new vm.Script(code, { filename: `index.html<script#${i}>` })));
  });

  test('handlers referenced from HTML attributes exist as functions in the page script', () => {
    const scriptText = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
    const defined = new Set([...scriptText.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)].map(m => m[1]));
    const ignore = new Set(['if', 'for', 'while', 'switch', 'return', 'event', 'this', 'document', 'window', 'tablePagination', 'Swal', 'confirm', 'alert', 'toggleTheme']);
    const used = new Set();
    for (const m of html.matchAll(/\bon(?:click|change|input|submit|keyup|keydown)="([^"]*)"/g)) {
      for (const call of m[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) used.add(call[1]);
    }
    const missing = [...used].filter(n => !defined.has(n) && !ignore.has(n));
    assert.deepEqual(missing, []);
  });
});

describe('mobile app (Expo) <-> server', () => {
  const apiFile = path.join(ROOT, '..', 'Goldloan-mobile-main', 'src', 'services', 'api.ts');
  const present = fs.existsSync(apiFile);

  test('every action the mobile app sends is handled by the REST endpoint', { skip: present ? false : 'Goldloan-mobile-main not found next to this repo' }, () => {
    const ts = fs.readFileSync(apiFile, 'utf8');
    const sent = [...new Set([...ts.matchAll(/(?:callGas|postToGas|getFromGas)(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g)].map(m => m[1]))];
    assert.ok(sent.length >= 20, `only found ${sent.length} actions`);
    const missing = sent.filter(a => !restCases.has(a));
    assert.deepEqual(missing, []);
  });
});

// A fresh, bootstrapped backend for tests that mutate state.
function app2() { return loadBackend(); }
