'use strict';
const { test, expect } = require('./fixtures');

/** One customer with a bank account, two ornaments and an active loan, so every screen has a row. */
function seedEverything(backend) {
  const s = backend.scenario();
  const loan = backend.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, ornamentIds: [s.orn1.OrnamentId] });
  return { ...s, loan };
}

test.describe('read-only "User" role', () => {
  test('sees the data but none of the add, edit, delete or close controls', async ({ app }) => {
    const { page, backend } = app;
    seedEverything(backend);
    await app.open();
    await app.loginAsViewer();

    await expect(page.locator('#header-user-badge')).toContainText('viewer (View Only)');
    await expect(page.locator('#nav-admin-users')).toBeHidden();

    for (const [section, table, addBtn] of [
      ['users', 'usersTable', '#btn-add-user'],
      ['bank-accounts', 'bankAccountsTable', '#btn-add-bank-account'],
      ['ornaments', 'ornamentsTable', '#btn-add-ornament'],
      ['loans', 'loansTable', '#btn-add-loan'],
    ]) {
      await app.go(section);
      await expect(page.locator(addBtn), `${section}: add button`).toBeHidden();
      await expect(app.rows(table).first(), `${section}: has data`).toBeVisible();
      await expect(app.rows(table).first().getByTitle('View'), `${section}: view`).toBeVisible();
      await expect(app.rows(table).first().getByTitle('Edit'), `${section}: edit`).toHaveCount(0);
      await expect(app.rows(table).first().getByTitle('Delete'), `${section}: delete`).toHaveCount(0);
    }

    await app.go('closure');
    await expect(app.rows('closureTable').first()).toContainText('View Only');
    await expect(page.getByRole('button', { name: 'Close & Release' })).toHaveCount(0);
  });

  test('is refused by the server even if the buttons are bypassed from the browser console', async ({ app }) => {
    const { page, backend } = app;
    seedEverything(backend);
    await app.open();
    await app.loginAsViewer();

    const call = (action, args) => page.evaluate(([a, x]) => new Promise(resolve =>
      google.script.run.withSuccessHandler(resolve).rpc(sessionStorage.getItem('goldLoanToken'), a, x)), [action, args]);

    expect((await call('deleteUser', ['U001'])).code).toBe(403);
    expect((await call('closeAndReleaseLoan', ['L001', 'sneaky'])).code).toBe(403);
    expect((await call('addUser', [{ FullName: 'Sneaky' }])).code).toBe(403);
    expect(backend.table('Users')).toHaveLength(1);
    expect(backend.table('Users')[0].Status).toBe('Active');
    expect(backend.table('Loans')[0].LoanStatus).toBe('Active');
  });
});

test.describe('the browser console cannot reach the server without logging in', () => {
  test('server functions are not exposed to the page at all', async ({ app }) => {
    const { page } = app;
    await app.open(); // still on the login screen, not signed in

    const exposed = await page.evaluate(() => ({
      getUsers: typeof google.script.run.getUsers,
      deleteUser: typeof google.script.run.deleteUser,
      addLoan: typeof google.script.run.addLoan,
      getSheetData: typeof google.script.run.getSheetData,
      getSheetData_: typeof google.script.run.getSheetData_,
      updateRow_: typeof google.script.run.updateRow_,
      rpc: typeof google.script.run.rpc,
      authenticateAdmin: typeof google.script.run.authenticateAdmin,
    }));
    expect(exposed).toEqual({
      getUsers: 'undefined', deleteUser: 'undefined', addLoan: 'undefined', getSheetData: 'undefined',
      getSheetData_: 'undefined', updateRow_: 'undefined', rpc: 'function', authenticateAdmin: 'function',
    });
    await expect(page.evaluate(() => google.script.run.getUsers())).rejects.toThrow(/not a function/);
  });

  test('rpc without a session is refused with 401 and returns no data', async ({ app }) => {
    const { page, backend } = app;
    backend.seed.user();
    await app.open();

    const res = await page.evaluate(() => new Promise(resolve =>
      google.script.run.withSuccessHandler(resolve).rpc('', 'getUsers', [])));
    expect(res.success).toBe(false);
    expect(res.code).toBe(401);
    expect(res.data).toBeUndefined();

    const forged = await page.evaluate(() => new Promise(resolve =>
      google.script.run.withSuccessHandler(resolve).rpc('SuperAdmin', 'deleteUser', ['U001'])));
    expect(forged.code).toBe(401);
    expect(backend.table('Users')[0].Status).toBe('Active');
  });
});
