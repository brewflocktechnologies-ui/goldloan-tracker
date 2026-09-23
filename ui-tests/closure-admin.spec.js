'use strict';
const { test, expect } = require('./fixtures');

test.describe('loan closure screen', () => {
  function seedLoan(backend, over = {}) {
    const s = backend.scenario();
    const loan = backend.seed.loan({
      UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanNumber: 'LN-0001', LoanAmount: 200000,
      ornamentIds: [s.orn1.OrnamentId, s.orn2.OrnamentId], ...over,
    });
    return { ...s, loan };
  }

  test('lists active loans with customer, bank, amount and ornament count', async ({ app }) => {
    seedLoan(app.backend);
    await app.open();
    await app.login();
    await app.go('closure');

    const row = app.rows('closureTable').first();
    await expect(row).toContainText('LN-0001');
    await expect(row).toContainText('Asha Rao');
    await expect(row).toContainText('SBI');
    await expect(row).toContainText('₹2,00,000');
    await expect(row).toContainText('2 item(s)');
  });

  test('closing a loan releases its ornaments and frees the bank limit', async ({ app }) => {
    const { page, backend } = app;
    seedLoan(backend);
    await app.open();
    await app.login();
    await app.go('closure');

    await page.getByRole('button', { name: 'Close & Release' }).click();
    await expect(app.toast()).toContainText('Enter closure remarks');
    await page.locator('.swal2-input').fill('Paid in full');
    await page.locator('.swal2-confirm').click();

    await expect(app.toast()).toContainText('Loan closed successfully!');
    await expect(app.rows('closureTable')).toHaveCount(0); // no longer active

    const loan = backend.table('Loans')[0];
    expect([loan.LoanStatus, loan.ClosureRemarks]).toEqual(['Closed', 'Paid in full']);
    expect(backend.table('Ornaments').map(o => o.Status)).toEqual(['Available', 'Available']);
    expect(backend.table('BankAccounts')[0].UtilizedLoanAmount).toBe(0);

    await app.go('ornaments');
    await expect(app.rows('ornamentsTable').filter({ hasText: 'Chain' })).toContainText('Available');
    await app.go('bank-accounts');
    await expect(app.rows('bankAccountsTable').first()).toContainText('₹5,00,000'); // fully available again
  });

  test('cancelling the dialog leaves the loan active', async ({ app }) => {
    const { page, backend } = app;
    seedLoan(backend);
    await app.open();
    await app.login();
    await app.go('closure');

    await page.getByRole('button', { name: 'Close & Release' }).click();
    await page.locator('.swal2-cancel').click();

    await expect(app.rows('closureTable')).toHaveCount(1);
    expect(backend.table('Loans')[0].LoanStatus).toBe('Active');
    expect(backend.table('Ornaments').map(o => o.Status)).toEqual(['Pledged', 'Pledged']);
  });

  test('the search box finds a loan by number or customer', async ({ app }) => {
    const { page, backend } = app;
    const s = seedLoan(backend);
    const other = backend.seed.user({ FullName: 'Bala Krishna', MobileNumber: '8880002222' });
    const bank2 = backend.seed.bank(other.UserId, { AccountNumber: '999' });
    const orn = backend.seed.ornament({ UserId: other.UserId, OrnamentName: 'Ring' });
    backend.seed.loan({ UserId: other.UserId, BankAccountId: bank2.BankAccountId, LoanNumber: 'LN-0002', LoanAmount: 5000, ornamentIds: [orn.OrnamentId] });
    void s;
    await app.open();
    await app.login();
    await app.go('closure');

    const visibleRows = page.locator('#closureTable tbody tr:visible');
    await expect(visibleRows).toHaveCount(2);
    await page.locator('#closureSearchInput').fill('bala');
    await expect(visibleRows).toHaveCount(1);
    await expect(visibleRows.first()).toContainText('LN-0002');
  });
});

test.describe('admin login accounts screen', () => {
  const SAVE = '#saveAdminUserBtn';

  test('lists the accounts and protects your own from deletion', async ({ app }) => {
    const { backend } = app;
    backend.api(backend.superToken()).addAdminUser({ username: 'staff1', password: 'pw1234', role: 'User' }, backend.superToken());
    await app.open();
    await app.login();
    await app.go('admin-users');

    await expect(app.rows('adminUsersTable')).toHaveCount(2);
    const me = app.rows('adminUsersTable').filter({ hasText: 'admin' }).first();
    await expect(me).toContainText('SuperAdmin');
    await expect(me).toContainText('Current User');
    await expect(me.getByTitle('Delete Account')).toHaveCount(0);
    const staff = app.rows('adminUsersTable').filter({ hasText: 'staff1' });
    await expect(staff).toContainText('Read-Only');
    await expect(staff.getByTitle('Delete Account')).toBeVisible();
  });

  test('creating a login user works, and the new user can sign in as read-only', async ({ app }) => {
    const { page, backend } = app;
    await app.open();
    await app.login();
    await app.go('admin-users');

    await page.locator('#btn-add-admin-user').click();
    await expect(page.locator('#adminUserModal')).toBeVisible();
    await page.locator('#adminUsername').fill('staff1');
    await page.locator('#adminPassword').fill('staff-pass');
    await expect(page.locator('#adminRole')).toHaveValue('User'); // safe default
    await page.locator(SAVE).click();

    await expect(app.toast()).toContainText("Login user 'staff1' created");
    await expect(app.rows('adminUsersTable').filter({ hasText: 'staff1' })).toContainText('User');
    const saved = backend.table('Admins').find(a => a.Username === 'staff1');
    expect(saved.Role).toBe('User');
    expect(saved.Password).toMatch(/^[0-9a-f]{64}$/); // stored hashed
    expect(backend.login('staff1', 'staff-pass').success).toBe(true);
  });

  test('the form will not submit without a password, and nothing is sent', async ({ app }) => {
    const { page, backend } = app;
    await app.open();
    await app.login();
    await app.go('admin-users');
    await page.locator('#btn-add-admin-user').click();
    await page.locator('#adminUsername').fill('staff1');
    await page.locator(SAVE).click();

    // the password field is `required`, so the browser itself blocks the submit
    await expect(page.locator('#adminUserModal')).toBeVisible();
    expect(await page.locator('#adminPassword').evaluate(el => el.validity.valueMissing)).toBe(true);
    expect(backend.table('Admins')).toHaveLength(1);
  });

  test('deleting a login user asks first, then they can no longer sign in', async ({ app }) => {
    const { page, backend } = app;
    backend.api(backend.superToken()).addAdminUser({ username: 'staff1', password: 'pw1234' }, backend.superToken());
    await app.open();
    await app.login();
    await app.go('admin-users');

    await app.rows('adminUsersTable').filter({ hasText: 'staff1' }).getByTitle('Delete Account').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.locator('#confirmModalConfirmBtn').click();

    await expect(app.toast()).toContainText("Account 'staff1' deleted.");
    await expect(app.rows('adminUsersTable').filter({ hasText: 'staff1' })).toHaveCount(0);
    expect(backend.login('staff1', 'pw1234').success).toBe(false);
  });
});
