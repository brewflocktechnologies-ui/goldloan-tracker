'use strict';
/**
 * KNOWN UI BUGS. Each is written as the behaviour we WANT and marked test.fail(), so:
 *   - the run stays green while the bug exists, and
 *   - Playwright reports it as a failure ("expected to fail but passed") the moment the
 *     bug is fixed. When that happens, change test.fail( to test( to keep it as a
 *     permanent regression test.
 */
const { test, expect } = require('./fixtures');

test.describe('KNOWN BUGS (UI)', () => {
  test.fail('a customer whose name has an apostrophe can still have their loan closed', async ({ app }) => {
    // closure table builds:  onclick="confirmCloseAndRelease('L001', 'D'Souza')"  -> JavaScript syntax error
    const { page, backend } = app;
    const user = backend.seed.user({ FullName: "Peter D'Souza" });
    const bank = backend.seed.bank(user.UserId);
    const orn = backend.seed.ornament({ UserId: user.UserId });
    backend.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [orn.OrnamentId] });
    await app.open();
    await app.login();
    await app.go('closure');

    await page.getByRole('button', { name: 'Close & Release' }).click();
    await expect(app.toast()).toContainText('Enter closure remarks', { timeout: 2000 });
  });

  test.fail('customer names are shown as text and never run as HTML or script', async ({ app }) => {
    // table rows are built with innerHTML and no escaping -> stored XSS
    const { page, backend } = app;
    backend.seed.user({ FullName: '<img src=x onerror="window.__xss=1">' });
    await app.open();
    await app.login();
    await app.go('users');

    await expect(app.rows('usersTable')).toHaveCount(1);
    await page.waitForTimeout(500); // give a broken image time to fire onerror
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(app.rows('usersTable').first()).toContainText('<img src=x'); // visible as plain text
  });

  test.fail('remarks and other free text cannot inject HTML into the loan detail view', async ({ app }) => {
    const { page, backend } = app;
    const s = backend.scenario();
    backend.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, ornamentIds: [s.orn1.OrnamentId] });
    backend.seed.ornament({ UserId: s.user.UserId, OrnamentName: '<b id="injected">Bold</b>' });
    await app.open();
    await app.login();
    await app.go('ornaments');

    await expect(app.rows('ornamentsTable').filter({ hasText: 'Bold' })).toHaveCount(1);
    await expect(page.locator('#injected')).toHaveCount(0);
  });

  test.fail('the page can be zoomed (pinch-zoom is not disabled)', async ({ app }) => {
    // <meta name="viewport" ... maximum-scale=1.0, user-scalable=no> blocks zoom: an accessibility failure
    const { page } = app;
    await app.open();
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/);
  });
});
