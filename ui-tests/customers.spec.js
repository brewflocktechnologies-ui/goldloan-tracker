'use strict';
const { test, expect } = require('./fixtures');

const SAVE_USER = 'button[onclick="submitUser(this)"]';

test.describe('customers (Users screen)', () => {
  test('adding a customer through the form saves it and lists it', async ({ app }) => {
    const { page, backend } = app;
    await app.open();
    await app.login();
    await app.go('users');
    await expect(app.rows('usersTable')).toHaveCount(0);

    await page.locator('#btn-add-user').click();
    await expect(page.locator('#userModal')).toBeVisible();
    await expect(page.locator('#userModalTitle')).toHaveText('Add User');
    await page.locator('#userFullName').fill('Asha Rao');
    await page.locator('#userMobileNumber').fill('9990001111');
    await page.locator('#userCity').fill('Bengaluru');
    await page.locator(SAVE_USER).click();

    await expect(page.locator('#userModal')).toBeHidden();
    await expect(app.toast()).toContainText('User added successfully');
    await expect(app.rows('usersTable')).toHaveCount(1);
    const row = app.rows('usersTable').first();
    await expect(row).toContainText('U001');
    await expect(row).toContainText('Asha Rao');
    await expect(row).toContainText('9990001111');
    await expect(row).toContainText('Active');

    const saved = backend.table('Users')[0];
    expect([saved.UserId, saved.FullName, saved.MobileNumber, saved.City, saved.Status])
      .toEqual(['U001', 'Asha Rao', '9990001111', 'Bengaluru', 'Active']);
  });

  test('the form refuses a customer with no name and saves nothing', async ({ app }) => {
    const { page, backend } = app;
    await app.open();
    await app.login();
    await app.go('users');
    await page.locator('#btn-add-user').click();
    await page.locator('#userMobileNumber').fill('9990001111');
    await page.locator(SAVE_USER).click();

    await expect(app.toast()).toContainText('Full Name is required.');
    await expect(page.locator('#userModal')).toBeVisible();
    expect(backend.table('Users')).toHaveLength(0);
  });

  test('editing shows the current values and saves the change', async ({ app }) => {
    const { page, backend } = app;
    backend.seed.user({ FullName: 'Asha Rao', City: 'Mysuru' });
    await app.open();
    await app.login();
    await app.go('users');

    await app.rows('usersTable').first().getByTitle('Edit').click();
    await expect(page.locator('#userModalTitle')).toHaveText('Edit User');
    await expect(page.locator('#userFullName')).toHaveValue('Asha Rao');
    await expect(page.locator('#userCity')).toHaveValue('Mysuru');

    await page.locator('#userFullName').fill('Asha R. Rao');
    await page.locator(SAVE_USER).click();

    await expect(app.toast()).toContainText('User updated successfully');
    await expect(app.rows('usersTable').first()).toContainText('Asha R. Rao');
    const saved = backend.table('Users')[0];
    expect(saved.FullName).toBe('Asha R. Rao');
    expect(saved.City).toBe('Mysuru');
    expect(saved.UpdatedDate).toBeTruthy();
  });

  test('deleting asks for confirmation, and cancel keeps the customer', async ({ app }) => {
    const { page, backend } = app;
    backend.seed.user({ FullName: 'Asha Rao' });
    await app.open();
    await app.login();
    await app.go('users');

    await app.rows('usersTable').first().getByTitle('Delete').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await expect(page.locator('#confirmModalMessage')).toContainText('U001');
    await page.locator('#confirmModalCancelBtn').click();
    await expect(page.locator('#confirmModal')).toBeHidden();
    await expect(app.rows('usersTable')).toHaveCount(1);
    expect(backend.table('Users')[0].Status).toBe('Active');
  });

  test('confirming a delete removes the customer from the list (soft delete in the sheet)', async ({ app }) => {
    const { page, backend } = app;
    backend.seed.user({ FullName: 'Asha Rao' });
    await app.open();
    await app.login();
    await app.go('users');

    await app.rows('usersTable').first().getByTitle('Delete').click();
    await page.locator('#confirmModalConfirmBtn').click();

    await expect(app.toast()).toContainText('User deleted.');
    await expect(app.rows('usersTable')).toHaveCount(0);
    expect(backend.table('Users')[0].Status).toBe('Deleted');
  });

  test('the search box filters the list as you type', async ({ app }) => {
    const { page, backend } = app;
    backend.seed.user({ FullName: 'Asha Rao' });
    backend.seed.user({ FullName: 'Bala Krishna', MobileNumber: '8880002222' });
    await app.open();
    await app.login();
    await app.go('users');

    const visibleRows = page.locator('#usersTable tbody tr:visible');
    await expect(visibleRows).toHaveCount(2);
    await page.locator('#usersTable-search').fill('bala');
    await expect(visibleRows).toHaveCount(1);
    await expect(visibleRows.first()).toContainText('Bala Krishna');
    await page.locator('#usersTable-search').fill('nobody-called-this');
    await expect(page.locator('#usersTable')).toContainText('No matching records found');
    await page.locator('#usersTable-search').fill('');
    await expect(visibleRows).toHaveCount(2);
  });

  test('the detail view shows the customer\'s KYC details', async ({ app }) => {
    const { page, backend } = app;
    backend.seed.user({ FullName: 'Asha Rao', AadhaarNumber: '123412341234', PANNumber: 'ABCDE1234F', Email: 'asha@example.com' });
    await app.open();
    await app.login();
    await app.go('users');

    await app.rows('usersTable').first().getByTitle('View').click();
    const modal = page.locator('#detailViewModal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('User Profile Details');
    await expect(modal).toContainText('Asha Rao');
    await expect(modal).toContainText('123412341234');
    await expect(modal).toContainText('ABCDE1234F');
    await expect(modal).toContainText('asha@example.com');
  });
});

test.describe('bank accounts screen', () => {
  const SAVE = 'button[onclick="submitBankAccount(this)"]';

  test('adding an account shows its limit and available amount', async ({ app }) => {
    const { page, backend } = app;
    backend.seed.user({ FullName: 'Asha Rao' });
    await app.open();
    await app.login();
    await app.go('bank-accounts');

    await page.locator('#btn-add-bank-account').click();
    await page.locator('#baUserId').selectOption('U001');
    await page.locator('#baAccountHolderName').fill('Asha Rao');
    await page.locator('#baAccountNumber').fill('111222333');
    await page.locator('#baBankName').fill('HDFC');
    await page.locator('#baIFSCCode').fill('HDFC0000001');
    await page.locator('#baMaxLoanAmount').fill('250000');
    await expect(page.locator('#baAvailableLoanAmount')).toHaveValue('250000.00');
    await page.locator(SAVE).click();

    await expect(app.toast()).toContainText('added successfully');
    const row = app.rows('bankAccountsTable').first();
    await expect(row).toContainText('BA001');
    await expect(row).toContainText('HDFC');
    await expect(row).toContainText('₹2,50,000');
    const saved = backend.table('BankAccounts')[0];
    expect([saved.UserId, saved.MaxLoanAmount, saved.UtilizedLoanAmount]).toEqual(['U001', 250000, 0]);
  });

  test('utilised and available limits reflect an active loan', async ({ app }) => {
    const { page, backend } = app;
    const s = backend.scenario();
    backend.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanAmount: 120000, ornamentIds: [s.orn1.OrnamentId] });
    await app.open();
    await app.login();
    await app.go('bank-accounts');

    const row = app.rows('bankAccountsTable').first();
    await expect(row).toContainText('₹5,00,000'); // limit
    await expect(row).toContainText('₹1,20,000'); // utilised
    await expect(row).toContainText('₹3,80,000'); // available
    void page;
  });

  test('deleting an account asks first, then removes it from the list', async ({ app }) => {
    const { page, backend } = app;
    const user = backend.seed.user();
    backend.seed.bank(user.UserId);
    await app.open();
    await app.login();
    await app.go('bank-accounts');

    await app.rows('bankAccountsTable').first().getByTitle('Delete').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.locator('#confirmModalConfirmBtn').click();
    await expect(app.rows('bankAccountsTable')).toHaveCount(0);
    expect(backend.table('BankAccounts')[0].Status).toBe('Deleted');
  });
});
