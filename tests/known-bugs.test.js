'use strict';
/**
 * KNOWN BUGS — each test states the behaviour we WANT and is marked `todo`, so it:
 *   - does not fail the run while the bug exists (it is reported as "todo"), and
 *   - starts reporting as a normal pass the moment the bug is fixed.
 * When you fix one, delete its `todo` option so it becomes a permanent regression test.
 *
 * Found in the code review of code.js / index.html; see the summary in the chat history.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend');

const photo = { name: 'p.png', mimeType: 'image/png', base64: Buffer.from('x').toString('base64') };

describe('BUG: loan integrity', () => {
  test('an ornament already pledged to an active loan cannot be pledged again', { todo: 'addLoan/updateLoan never check ornament status' }, () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 50000, ornamentIds: [orn1.OrnamentId] });
    const res = app.api(app.superToken()).addLoan(app.seed.loanPayload({
      UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 50000, ornamentIds: [orn1.OrnamentId],
    }));
    assert.equal(res.success, false);
  });

  test('a customer cannot pledge an ornament that belongs to someone else', { todo: 'ownership is never checked' }, () => {
    const app = loadBackend();
    const { user, bank } = app.scenario();
    const other = app.seed.user({ FullName: 'Other' });
    const theirs = app.seed.ornament({ UserId: other.UserId, OrnamentName: 'Not yours' });
    const res = app.api(app.superToken()).addLoan(app.seed.loanPayload({
      UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [theirs.OrnamentId],
    }));
    assert.equal(res.success, false);
  });

  test('updateLoan with a partial payload must not wipe the amount, rate or fees', { todo: 'missing fields are parsed to 0 and overwrite the row' }, () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    const loan = app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 100000, InterestRate: 12, ornamentIds: [orn1.OrnamentId] });
    const res = app.api(app.superToken()).updateLoan(loan.LoanId, { Remarks: 'called the customer' });
    const row = app.table('Loans')[0];
    assert.ok(res.success === false || (row.LoanAmount === 100000 && row.InterestRate === 12), `amount=${row.LoanAmount} rate=${row.InterestRate}`);
  });

  test('updateLoan rejects a zero or negative amount, like addLoan does', { todo: 'only addLoan validates the amount' }, () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    const loan = app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [orn1.OrnamentId] });
    const res = app.api(app.superToken()).updateLoan(loan.LoanId, app.seed.loanPayload({
      UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanNumber: loan.LoanNumber, LoanAmount: 0, ornamentIds: [orn1.OrnamentId],
    }));
    assert.equal(res.success, false);
  });

  test('closing a loan that is already Closed is refused', { todo: 'closeAndReleaseLoan does not check the current status' }, () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    const loan = app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [orn1.OrnamentId] });
    const api = app.api(app.superToken());
    api.closeAndReleaseLoan(loan.LoanId, 'first');
    assert.equal(api.closeAndReleaseLoan(loan.LoanId, 'second').success, false);
  });

  test('closing a loan writes a Releases record for each ornament', { todo: 'the Releases sheet is never populated' }, () => {
    const app = loadBackend();
    const { user, bank, orn1, orn2 } = app.scenario();
    const loan = app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [orn1.OrnamentId, orn2.OrnamentId] });
    app.api(app.superToken()).closeAndReleaseLoan(loan.LoanId, '');
    assert.equal(app.table('Releases').length, 2);
  });

  test('a payment cannot be recorded against a loan that does not exist', { todo: 'addPayment does not validate LoanId' }, () => {
    const app = loadBackend();
    const res = app.api(app.superToken()).addPayment({ LoanId: 'L999', PaymentDate: '2026-10-01', TotalPaidAmount: 500 });
    assert.equal(res.success, false);
  });
});

describe('BUG: deleting records that are still in use', () => {
  test('a customer with an active loan cannot be deleted', { todo: 'deleteUser has no dependency check' }, () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [orn1.OrnamentId] });
    assert.equal(app.api(app.superToken()).deleteUser(user.UserId).success, false);
  });

  test('a bank account with an active loan cannot be deleted', { todo: 'deleteBankAccount has no dependency check' }, () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [orn1.OrnamentId] });
    assert.equal(app.api(app.superToken()).deleteBankAccount(bank.BankAccountId).success, false);
  });

  test('a pledged ornament cannot be deleted', { todo: 'deleteOrnament does not check Status' }, () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [orn1.OrnamentId] });
    assert.equal(app.api(app.superToken()).deleteOrnament(orn1.OrnamentId).success, false);
  });

  test('updating or deleting a customer that does not exist reports failure', { todo: 'updateRow\'s "not found" result is ignored' }, () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    assert.equal(api.updateUser('U999', { FullName: 'Ghost' }).success, false);
    assert.equal(api.deleteUser('U999').success, false);
  });
});

describe('BUG: input handling', () => {
  test('a customer cannot be created without a name (validated on the server, not just the form)', { todo: 'addUser does not validate' }, () => {
    const app = loadBackend();
    assert.equal(app.api(app.superToken()).addUser({}).success, false);
  });

  test('updateUser cannot rewrite the customer id', { todo: 'updateRow writes any key the client sends' }, () => {
    const app = loadBackend();
    const user = app.seed.user();
    app.api(app.superToken()).updateUser(user.UserId, { UserId: 'U777', FullName: 'Renamed' });
    assert.equal(app.table('Users')[0].UserId, user.UserId);
  });

  test('unknown fields in a request do not create new sheet columns', { todo: 'ensureSheetHeaders adds a column for any key' }, () => {
    const app = loadBackend();
    const user = app.seed.user();
    app.api(app.superToken()).updateUser(user.UserId, { EvilColumn: 'x' });
    assert.equal(app.rows('Users')[0].includes('EvilColumn'), false);
  });
});

describe('BUG: files and privacy', () => {
  test('deleteOrnamentImage only trashes files that belong to that ornament', { todo: 'it trashes any Drive file URL it is given' }, () => {
    const app = loadBackend();
    app.api(app.superToken()).addUser({ FullName: 'Asha', files: [photo] });
    const [someoneElsesFile] = [...app.fake.drive.files.values()];
    const orn = app.seed.ornament();
    app.api(app.superToken()).deleteOrnamentImage(orn.OrnamentId, `https://drive.google.com/file/d/${someoneElsesFile.id}/view?usp=drivesdk`);
    assert.equal(someoneElsesFile.trashed, false);
  });

  test('uploaded KYC documents are not shared with "anyone with the link"', { todo: 'processDriveFiles uses ANYONE_WITH_LINK' }, () => {
    const app = loadBackend();
    app.api(app.superToken()).addUser({ FullName: 'Asha', files: [photo] });
    const [file] = [...app.fake.drive.files.values()];
    assert.notEqual(file.sharing && file.sharing.access, 'ANYONE_WITH_LINK');
  });

  test('a date of birth typed as 1990-05-17 is shown as 1990-05-17 even when Sheets stores it as a date', {
    todo: 'getSheetData converts Date cells with toISOString() (UTC); in IST this is the previous day. Verify against real Sheets with the staging smoke test.',
  }, () => {
    const app = loadBackend({ autoParseDates: true, sheetTzOffsetMin: 330 });
    app.api(app.superToken()).addUser({ FullName: 'Asha', DateOfBirth: '1990-05-17' });
    const dob = app.api(app.superToken()).getUsers().data[0].DateOfBirth;
    assert.equal(String(dob).split('T')[0], '1990-05-17'); // this is exactly what the UI displays
  });
});

describe('BUG: sessions outlive account changes', () => {
  test('demoting a SuperAdmin takes effect immediately for their existing session', { todo: 'the role is copied into the token at login and never re-read' }, () => {
    const app = loadBackend();
    const boss = app.superToken();
    const api = app.api(boss);
    api.addAdminUser({ username: 'boss2', password: 'pw1234', role: 'SuperAdmin' }, boss);
    const boss2Token = app.login('boss2', 'pw1234').data.token;
    const boss2 = app.table('Admins').find(a => a.Username === 'boss2');
    api.updateAdminUser(boss2.AdminId, { role: 'User' }, '', boss);
    app.seed.user();
    assert.equal(app.api(boss2Token).deleteUser('U001').success, false);
  });

  test('deactivating an account signs out its existing session', { todo: 'sessions are not revoked when the account is deactivated or deleted' }, () => {
    const app = loadBackend();
    const viewerToken = app.viewerToken();
    const viewer = app.table('Admins').find(a => a.Username === 'viewer');
    app.api(app.superToken()).updateAdminUser(viewer.AdminId, { status: 'Inactive' }, '', app.superToken());
    assert.equal(app.api(viewerToken).getUsers().code, 401);
  });
});
