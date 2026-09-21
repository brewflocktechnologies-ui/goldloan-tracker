'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend');

const scan = (name = 'passbook.jpg') => ({ name, mimeType: 'image/jpeg', base64: Buffer.from('scan').toString('base64') });

describe('bank accounts: create and read', () => {
  test('creates an Active account with numeric limits and zero utilisation', () => {
    const app = loadBackend();
    const user = app.seed.user();
    const res = app.api(app.superToken()).addBankAccount({
      UserId: user.UserId, AccountHolderName: 'Asha Rao', AccountNumber: '111222333', BankName: 'HDFC',
      IFSCCode: 'HDFC0000001', AccountType: 'Savings', UPI_ID: 'asha@hdfc', MaxLoanAmount: '250000',
    });
    assert.equal(res.success, true);
    assert.equal(res.data.BankAccountId, 'BA001');
    const row = app.table('BankAccounts')[0];
    assert.equal(row.Status, 'Active');
    assert.equal(row.MaxLoanAmount, 250000);
    assert.equal(row.UtilizedLoanAmount, 0);
    assert.equal(row.UPI_ID, 'asha@hdfc');
  });

  test('getBankAccounts adds AvailableLoanAmount and can filter by customer', () => {
    const app = loadBackend();
    const u1 = app.seed.user({ FullName: 'One' });
    const u2 = app.seed.user({ FullName: 'Two' });
    app.seed.bank(u1.UserId, { MaxLoanAmount: 300000 });
    app.seed.bank(u2.UserId, { MaxLoanAmount: 100000, AccountNumber: '999' });
    const api = app.api(app.superToken());
    const all = api.getBankAccounts().data;
    assert.equal(all.length, 2);
    assert.equal(all[0].AvailableLoanAmount, 300000);
    const only = api.getBankAccounts(u2.UserId).data;
    assert.equal(only.length, 1);
    assert.equal(only[0].UserId, u2.UserId);
  });

  test('uploads the passbook image to the Passbook_Images folder', () => {
    const app = loadBackend();
    const user = app.seed.user();
    app.api(app.superToken()).addBankAccount({
      UserId: user.UserId, AccountHolderName: 'A', AccountNumber: '1', BankName: 'SBI', files: [scan()],
    });
    const [file] = [...app.fake.drive.files.values()];
    assert.equal(file.folder, 'Passbook_Images');
    assert.match(app.table('BankAccounts')[0].PassbookImage, /drive\.google\.com\/file\/d\//);
  });
});

describe('bank accounts: limits follow the loans', () => {
  test('utilisation and available limit track active loans, and return after closure', () => {
    const app = loadBackend();
    const { user, bank, orn1, orn2 } = app.scenario();
    const api = app.api(app.superToken());
    const available = () => api.getBankAccounts().data[0].AvailableLoanAmount;
    const utilised = () => app.table('BankAccounts')[0].UtilizedLoanAmount;

    assert.equal(available(), 500000);
    const l1 = app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 100000, ornamentIds: [orn1.OrnamentId] });
    assert.equal(utilised(), 100000);
    assert.equal(available(), 400000);
    app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 150000, ornamentIds: [orn2.OrnamentId] });
    assert.equal(utilised(), 250000);
    assert.equal(available(), 250000);

    api.closeAndReleaseLoan(l1.LoanId, 'paid');
    assert.equal(utilised(), 150000);
    assert.equal(available(), 350000);
  });

  test('lowering the limit below what is already utilised shows 0 available, never negative', () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    const api = app.api(app.superToken());
    app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 200000, ornamentIds: [orn1.OrnamentId] });
    api.updateBankAccount(bank.BankAccountId, { MaxLoanAmount: 50000 });
    const acc = api.getBankAccounts().data[0];
    assert.equal(acc.MaxLoanAmount, 50000);
    assert.equal(acc.UtilizedLoanAmount, 200000);
    assert.equal(acc.AvailableLoanAmount, 0);
  });

  test('a stale utilisation value in the sheet is corrected on read', () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 100000, ornamentIds: [orn1.OrnamentId] });
    const col = app.rows('BankAccounts')[0].indexOf('UtilizedLoanAmount');
    app.rows('BankAccounts')[1][col] = 999;
    const acc = app.api(app.superToken()).getBankAccounts().data[0];
    assert.equal(acc.UtilizedLoanAmount, 100000);
    assert.equal(app.table('BankAccounts')[0].UtilizedLoanAmount, 100000);
  });
});

describe('bank accounts: update and delete', () => {
  test('updateBankAccount changes the fields sent', () => {
    const app = loadBackend();
    const user = app.seed.user();
    const bank = app.seed.bank(user.UserId);
    const res = app.api(app.superToken()).updateBankAccount(bank.BankAccountId, { BankName: 'Canara', BranchName: 'MG Road', MaxLoanAmount: 800000 });
    assert.equal(res.success, true);
    const row = app.table('BankAccounts')[0];
    assert.equal(row.BankName, 'Canara');
    assert.equal(row.BranchName, 'MG Road');
    assert.equal(row.MaxLoanAmount, 800000);
    assert.equal(row.AccountNumber, '1234567890');
    assert.ok(row.UpdatedDate);
  });

  test('deleteBankAccount is a soft delete and hides the account from the list', () => {
    const app = loadBackend();
    const user = app.seed.user();
    const bank = app.seed.bank(user.UserId);
    const api = app.api(app.superToken());
    assert.equal(api.deleteBankAccount(bank.BankAccountId).success, true);
    assert.equal(app.table('BankAccounts')[0].Status, 'Deleted');
    assert.deepEqual(api.getBankAccounts().data, []);
  });

  test('updateBankAccount with deletePassbookImage clears the link and trashes the file', () => {
    const app = loadBackend();
    const user = app.seed.user();
    const bank = app.seed.bank(user.UserId, { files: [scan()] });
    const [file] = [...app.fake.drive.files.values()];
    app.api(app.superToken()).updateBankAccount(bank.BankAccountId, { deletePassbookImage: true });
    assert.equal(app.table('BankAccounts')[0].PassbookImage, '');
    assert.equal(file.trashed, true);
  });

  test('deleteBankAccountPassbook clears the link and trashes the file, keeping the account', () => {
    const app = loadBackend();
    const user = app.seed.user();
    const bank = app.seed.bank(user.UserId, { files: [scan()] });
    const [file] = [...app.fake.drive.files.values()];
    assert.equal(app.api(app.superToken()).deleteBankAccountPassbook(bank.BankAccountId).success, true);
    const row = app.table('BankAccounts')[0];
    assert.equal(row.PassbookImage, '');
    assert.equal(row.Status, 'Active');
    assert.equal(file.trashed, true);
  });

  test('a read-only User cannot change bank accounts', () => {
    const app = loadBackend();
    const user = app.seed.user();
    const bank = app.seed.bank(user.UserId);
    const viewer = app.api(app.viewerToken());
    assert.equal(viewer.getBankAccounts().success, true);
    assert.equal(viewer.updateBankAccount(bank.BankAccountId, { MaxLoanAmount: 1 }).code, 403);
    assert.equal(viewer.deleteBankAccount(bank.BankAccountId).code, 403);
    assert.equal(app.table('BankAccounts')[0].MaxLoanAmount, 500000);
  });
});
