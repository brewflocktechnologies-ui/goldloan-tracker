'use strict';
const { test, expect } = require('./fixtures');

/**
 * Walks every screen and detail view with realistic data and fails on any JavaScript
 * error thrown in the page. This is the cheap catch-all for "I edited one function
 * and something unrelated stopped rendering".
 */
test.describe('every screen renders without JavaScript errors', () => {
  function seedRealisticData(backend) {
    const s = backend.scenario();
    const loan = backend.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, ornamentIds: [s.orn1.OrnamentId] });
    const api = backend.api(backend.superToken());
    api.addPayment({ LoanId: loan.LoanId, PaymentDate: '2026-10-01', InterestAmount: 500, TotalPaidAmount: 500 });
    const closed = backend.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanAmount: 50000, ornamentIds: [s.orn2.OrnamentId] });
    api.closeAndReleaseLoan(closed.LoanId, 'done');
    api.addAdminUser({ username: 'staff1', password: 'pw1234' }, backend.superToken());
    return { ...s, loan };
  }

  const SCREENS = [
    ['dashboard', 'Dashboard Overview'],
    ['users', 'User Management'],
    ['bank-accounts', 'Bank Accounts'],
    ['ornaments', 'Ornaments'],
    ['loans', 'Loans'],
    ['closure', 'Loan Closure'],
    ['admin-users', 'Admin Login Accounts'],
  ];

  test('SuperAdmin: all seven screens open and show their title', async ({ app }) => {
    const { page, backend } = app;
    seedRealisticData(backend);
    app.useGoldRates();
    await app.open();
    await app.login();
    for (const [section, title] of SCREENS) {
      await app.go(section);
      await expect(page.locator('#header-title'), section).toHaveText(title);
    }
    expect(app.pageErrors).toEqual([]);
  });

  test('read-only User: every screen they can reach opens without errors', async ({ app }) => {
    const { page, backend } = app;
    seedRealisticData(backend);
    await app.open();
    await app.loginAsViewer();
    for (const [section, title] of SCREENS.filter(([s]) => s !== 'admin-users')) {
      await app.go(section);
      await expect(page.locator('#header-title'), section).toHaveText(title);
    }
    expect(app.pageErrors).toEqual([]);
  });

  test('dashboard totals match the data', async ({ app }) => {
    const { page, backend } = app;
    seedRealisticData(backend);
    app.useGoldRates();
    await app.open();
    await app.login();

    await expect(page.locator('#d-users')).toHaveText('1');
    await expect(page.locator('#d-accounts')).toHaveText('1');
    await expect(page.locator('#d-ornaments')).toHaveText('2');
    await expect(page.locator('#d-active-loans')).toHaveText('1');
    await expect(page.locator('#d-closed-loans')).toHaveText('1');
    await expect(page.locator('#d-loan-amount')).toHaveText('₹1,00,000');
    await expect(page.locator('#gold-price-22k')).toContainText('9,020');
    expect(app.pageErrors).toEqual([]);
  });

  test('when the gold-rate site is down the dashboard still loads and says the rates are a fallback', async ({ app }) => {
    const { page, backend } = app;
    seedRealisticData(backend); // default fixture: the rate site is unreachable
    await app.open();
    await app.login();

    await expect(page.locator('#d-users')).toHaveText('1');
    await expect(page.locator('#gold-price-22k')).not.toHaveText(/^\s*₹?—?\s*$/); // shows the baseline price
    expect(app.pageErrors).toEqual([]);
  });

  test('detail views open for a customer, bank account, ornament and loan', async ({ app }) => {
    const { page, backend } = app;
    seedRealisticData(backend);
    await app.open();
    await app.login();

    for (const [section, table, expected] of [
      ['users', 'usersTable', 'Asha Rao'],
      ['bank-accounts', 'bankAccountsTable', 'SBI'],
      ['ornaments', 'ornamentsTable', 'Chain'],
      ['loans', 'loansTable', 'Loan Reference'],
    ]) {
      await app.go(section);
      await app.rows(table).first().getByTitle('View').click();
      await expect(page.locator('#detailViewModal'), section).toBeVisible();
      await expect(page.locator('#detailViewModal'), section).toContainText(expected);
      await page.locator('#detailViewModal button[onclick*="hideModal"]').first().click();
      await expect(page.locator('#detailViewModal'), section).toBeHidden();
    }
    expect(app.pageErrors).toEqual([]);
  });

  test('sorting a column reorders the rows', async ({ app }) => {
    const { page, backend } = app;
    backend.seed.user({ FullName: 'Charu' });
    backend.seed.user({ FullName: 'Asha' });
    backend.seed.user({ FullName: 'Bala' });
    await app.open();
    await app.login();
    await app.go('users');

    const names = () => page.locator('#usersTable tbody tr td:nth-child(2)').allInnerTexts();
    await page.locator('#usersTable thead th', { hasText: 'Name' }).first().click();
    expect(await names()).toEqual(['Asha', 'Bala', 'Charu']);
    await page.locator('#usersTable thead th', { hasText: 'Name' }).first().click();
    expect(await names()).toEqual(['Charu', 'Bala', 'Asha']);
  });
});
