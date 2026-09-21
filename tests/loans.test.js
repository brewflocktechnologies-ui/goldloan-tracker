'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend');

const ornamentStatus = (app, id) => app.table('Ornaments').find(o => o.OrnamentId === id).Status;
const mappings = (app, loanId) => app.table('LoanOrnaments').filter(m => m.LoanId === loanId);
const utilised = (app, bankId) => app.table('BankAccounts').find(b => b.BankAccountId === bankId).UtilizedLoanAmount;

describe('loans: create', () => {
  test('creates an Active loan, pledges the ornaments and books the limit', () => {
    const app = loadBackend();
    const { user, bank, orn1, orn2 } = app.scenario();
    const res = app.api(app.superToken()).addLoan(app.seed.loanPayload({
      UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 120000, ornamentIds: [orn1.OrnamentId, orn2.OrnamentId],
    }));
    assert.equal(res.success, true);
    const loan = res.data;
    assert.equal(loan.LoanId, 'L001');
    assert.equal(loan.LoanStatus, 'Active');
    assert.equal(loan.BankName, 'SBI');

    assert.equal(ornamentStatus(app, orn1.OrnamentId), 'Pledged');
    assert.equal(ornamentStatus(app, orn2.OrnamentId), 'Pledged');
    assert.deepEqual(mappings(app, 'L001').map(m => [m.OrnamentId, m.Status]), [[orn1.OrnamentId, 'Pledged'], [orn2.OrnamentId, 'Pledged']]);
    assert.equal(utilised(app, bank.BankAccountId), 120000);
  });

  test('gross and net weight default to the sum of the pledged ornaments', () => {
    const app = loadBackend();
    const { user, bank, orn1, orn2 } = app.scenario(); // 10 g + 20 g
    const loan = app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [orn1.OrnamentId, orn2.OrnamentId] });
    assert.equal(loan.GrossWeight, 30);
    assert.equal(loan.NetWeight, 30);
  });

  test('weights typed on the form are kept', () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    const loan = app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [orn1.OrnamentId], GrossWeight: 11, NetWeight: 10.5 });
    assert.equal(loan.GrossWeight, 11);
    assert.equal(loan.NetWeight, 10.5);
  });

  test('refuses a duplicate loan number', () => {
    const app = loadBackend();
    const { user, bank, orn1, orn2 } = app.scenario();
    app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanNumber: 'LN-1', LoanAmount: 10000, ornamentIds: [orn1.OrnamentId] });
    const res = app.api(app.superToken()).addLoan(app.seed.loanPayload({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanNumber: 'LN-1', LoanAmount: 10000, ornamentIds: [orn2.OrnamentId] }));
    assert.equal(res.success, false);
    assert.match(res.error, /already exists/);
    assert.equal(app.table('Loans').length, 1);
  });

  test('a cancelled loan\'s number can be reused', () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    const first = app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanNumber: 'LN-1', ornamentIds: [orn1.OrnamentId] });
    const statusCol = app.rows('Loans')[0].indexOf('LoanStatus');
    app.rows('Loans')[1][statusCol] = 'Cancelled';
    const res = app.api(app.superToken()).addLoan(app.seed.loanPayload({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanNumber: 'LN-1', ornamentIds: [] }));
    assert.equal(res.success, true);
    assert.notEqual(res.data.LoanId, first.LoanId);
  });

  test('refuses an unknown bank account, and one that belongs to another customer', () => {
    const app = loadBackend();
    const { user, orn1 } = app.scenario();
    const other = app.seed.user({ FullName: 'Other' });
    const otherBank = app.seed.bank(other.UserId, { AccountNumber: '555' });
    const api = app.api(app.superToken());
    const unknown = api.addLoan(app.seed.loanPayload({ UserId: user.UserId, BankAccountId: 'BA999', ornamentIds: [orn1.OrnamentId] }));
    assert.match(unknown.error, /bank account not found/i);
    const foreign = api.addLoan(app.seed.loanPayload({ UserId: user.UserId, BankAccountId: otherBank.BankAccountId, ornamentIds: [orn1.OrnamentId] }));
    assert.match(foreign.error, /does not belong/);
    assert.equal(app.table('Loans').length, 0);
    assert.equal(ornamentStatus(app, orn1.OrnamentId), 'Available');
  });

  test('refuses a zero or negative amount', () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    const api = app.api(app.superToken());
    for (const amount of [0, -500, '', 'abc']) {
      const res = api.addLoan(app.seed.loanPayload({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: amount, ornamentIds: [orn1.OrnamentId] }));
      assert.equal(res.success, false, String(amount));
    }
    assert.equal(app.table('Loans').length, 0);
  });

  test('refuses an amount above the bank limit and leaves everything untouched', () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario(); // limit 500000
    const res = app.api(app.superToken()).addLoan(app.seed.loanPayload({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 500001, ornamentIds: [orn1.OrnamentId] }));
    assert.equal(res.success, false);
    assert.match(res.error, /exceeds the available limit/);
    assert.equal(app.table('Loans').length, 0);
    assert.equal(ornamentStatus(app, orn1.OrnamentId), 'Available');
    assert.equal(utilised(app, bank.BankAccountId), 0);
  });

  test('the limit counts loans already taken, and allows exactly the remainder', () => {
    const app = loadBackend();
    const { user, bank, orn1, orn2 } = app.scenario(); // limit 500000
    const api = app.api(app.superToken());
    app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 300000, ornamentIds: [orn1.OrnamentId] });
    const tooMuch = api.addLoan(app.seed.loanPayload({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 200001, ornamentIds: [orn2.OrnamentId] }));
    assert.equal(tooMuch.success, false);
    const exact = api.addLoan(app.seed.loanPayload({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 200000, ornamentIds: [orn2.OrnamentId] }));
    assert.equal(exact.success, true);
    assert.equal(utilised(app, bank.BankAccountId), 500000);
  });

  test('a read-only User cannot create a loan', () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    const res = app.api(app.viewerToken()).addLoan(app.seed.loanPayload({ UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [orn1.OrnamentId] }));
    assert.equal(res.code, 403);
    assert.equal(app.table('Loans').length, 0);
  });
});

describe('loans: read', () => {
  test('getLoans filters by customer and status and includes bank name and ornament ids', () => {
    const app = loadBackend();
    const { user, bank, orn1, orn2 } = app.scenario();
    const api = app.api(app.superToken());
    const l1 = app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 10000, ornamentIds: [orn1.OrnamentId] });
    app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 20000, ornamentIds: [orn2.OrnamentId] });
    api.closeAndReleaseLoan(l1.LoanId, '');

    assert.equal(api.getLoans().data.length, 2);
    assert.deepEqual(api.getLoans(undefined, 'Active').data.map(l => l.LoanId), ['L002']);
    assert.deepEqual(api.getLoans(user.UserId, 'Closed').data.map(l => l.LoanId), ['L001']);
    assert.deepEqual(api.getLoans('U999').data, []);
    const active = api.getLoans(undefined, 'Active').data[0];
    assert.equal(active.BankName, 'SBI');
    assert.deepEqual(active.ornamentIds, [orn2.OrnamentId]);
  });

  test('getLoanDetails returns the loan, its bank account, pledged ornaments and payments', () => {
    const app = loadBackend();
    const { user, bank, orn1 } = app.scenario();
    const loan = app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [orn1.OrnamentId] });
    const api = app.api(app.superToken());
    api.addPayment({ LoanId: loan.LoanId, PaymentDate: '2026-10-01', InterestAmount: 1000, TotalPaidAmount: 1000 });
    const d = api.getLoanDetails(loan.LoanId).data;
    assert.equal(d.loan.LoanId, loan.LoanId);
    assert.equal(d.bankAccount.BankAccountId, bank.BankAccountId);
    assert.deepEqual(d.ornaments.map(o => o.OrnamentName), ['Chain']);
    assert.equal(d.ornaments[0].Status, 'Pledged');
    assert.equal(d.payments.length, 1);
  });

  test('getLoanDetails for an unknown loan reports not found', () => {
    const app = loadBackend();
    const res = app.api(app.superToken()).getLoanDetails('L999');
    assert.equal(res.success, false);
    assert.match(res.error, /not found/i);
  });
});

describe('loans: edit', () => {
  const setup = () => {
    const app = loadBackend();
    const s = app.scenario();
    const loan = app.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanAmount: 100000, LoanNumber: 'LN-A', ornamentIds: [s.orn1.OrnamentId] });
    const edit = (over = {}) => app.api(app.superToken()).updateLoan(loan.LoanId, app.seed.loanPayload({
      UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanNumber: 'LN-A', LoanAmount: 100000, ornamentIds: [s.orn1.OrnamentId], ...over,
    }));
    return { app, ...s, loan, edit };
  };

  test('changing the amount within the limit updates the loan and the utilisation', () => {
    const { app, bank, loan, edit } = setup();
    const res = edit({ LoanAmount: 250000, InterestRate: 14 });
    assert.equal(res.success, true);
    const row = app.table('Loans')[0];
    assert.equal(row.LoanId, loan.LoanId);
    assert.equal(row.LoanAmount, 250000);
    assert.equal(row.InterestRate, 14);
    assert.ok(row.UpdatedDate);
    assert.equal(utilised(app, bank.BankAccountId), 250000);
  });

  test('an edit above the limit is refused and nothing changes', () => {
    const { app, bank, edit } = setup();
    const res = edit({ LoanAmount: 500001 });
    assert.equal(res.success, false);
    assert.match(res.error, /exceeds available limit/);
    assert.equal(app.table('Loans')[0].LoanAmount, 100000);
    assert.equal(utilised(app, bank.BankAccountId), 100000);
  });

  test('editing does not count the loan against its own limit', () => {
    const { app, edit } = setup();
    assert.equal(edit({ LoanAmount: 500000 }).success, true);
    assert.equal(app.table('Loans')[0].LoanAmount, 500000);
  });

  test('swapping ornaments un-pledges the removed one and pledges the new one', () => {
    const { app, orn1, orn2, loan, edit } = setup();
    const res = edit({ ornamentIds: [orn2.OrnamentId] });
    assert.equal(res.success, true);
    assert.equal(ornamentStatus(app, orn1.OrnamentId), 'Available');
    assert.equal(ornamentStatus(app, orn2.OrnamentId), 'Pledged');
    assert.deepEqual(mappings(app, loan.LoanId).map(m => m.OrnamentId), [orn2.OrnamentId]);
  });

  test('adding an ornament keeps the existing one pledged', () => {
    const { app, orn1, orn2, loan, edit } = setup();
    edit({ ornamentIds: [orn1.OrnamentId, orn2.OrnamentId] });
    assert.deepEqual(mappings(app, loan.LoanId).map(m => m.OrnamentId).sort(), [orn1.OrnamentId, orn2.OrnamentId].sort());
    assert.equal(ornamentStatus(app, orn1.OrnamentId), 'Pledged');
    assert.equal(ornamentStatus(app, orn2.OrnamentId), 'Pledged');
  });

  test('renaming to another loan\'s number is refused, keeping your own number is fine', () => {
    const { app, user, bank, orn2, edit } = setup();
    app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanNumber: 'LN-B', LoanAmount: 1000, ornamentIds: [orn2.OrnamentId] });
    const clash = edit({ LoanNumber: 'LN-B' });
    assert.equal(clash.success, false);
    assert.match(clash.error, /already exists/);
    assert.equal(edit({ LoanNumber: 'LN-A' }).success, true);
  });

  test('moving the loan to another bank account moves the utilisation with it', () => {
    const { app, user, bank, edit } = setup();
    const bank2 = app.seed.bank(user.UserId, { AccountNumber: '777', BankName: 'HDFC', MaxLoanAmount: 300000 });
    const res = edit({ BankAccountId: bank2.BankAccountId });
    assert.equal(res.success, true);
    assert.equal(utilised(app, bank.BankAccountId), 0);
    assert.equal(utilised(app, bank2.BankAccountId), 100000);
    assert.equal(app.table('Loans')[0].BankName, 'HDFC');
  });

  test('editing an unknown loan reports not found', () => {
    const { app } = setup();
    const res = app.api(app.superToken()).updateLoan('L999', app.seed.loanPayload());
    assert.equal(res.success, false);
    assert.match(res.error, /not found/i);
  });

  test('a read-only User cannot edit a loan', () => {
    const { app, loan } = setup();
    assert.equal(app.api(app.viewerToken()).updateLoan(loan.LoanId, { LoanAmount: 1 }).code, 403);
    assert.equal(app.table('Loans')[0].LoanAmount, 100000);
  });
});

describe('loans: close and release', () => {
  const setup = () => {
    const app = loadBackend();
    const s = app.scenario();
    const loan = app.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanAmount: 200000, ornamentIds: [s.orn1.OrnamentId, s.orn2.OrnamentId] });
    return { app, ...s, loan };
  };

  test('closing marks the loan Closed with a date and remarks', () => {
    const { app, loan } = setup();
    const res = app.api(app.superToken()).closeAndReleaseLoan(loan.LoanId, 'Paid in full');
    assert.equal(res.success, true);
    const row = app.table('Loans')[0];
    assert.equal(row.LoanStatus, 'Closed');
    assert.equal(row.ClosureRemarks, 'Paid in full');
    assert.ok(!isNaN(Date.parse(row.ClosedDate)));
  });

  test('closing releases every pledged ornament and its mapping', () => {
    const { app, orn1, orn2, loan } = setup();
    app.api(app.superToken()).closeAndReleaseLoan(loan.LoanId, '');
    for (const orn of [orn1, orn2]) {
      const row = app.table('Ornaments').find(o => o.OrnamentId === orn.OrnamentId);
      assert.equal(row.Status, 'Released');
      assert.equal(row.ReleasedLoanId, loan.LoanId);
      assert.ok(!isNaN(Date.parse(row.ReleaseDate)));
    }
    assert.ok(mappings(app, loan.LoanId).every(m => m.Status === 'Released'));
  });

  test('closing frees the bank limit', () => {
    const { app, bank, loan } = setup();
    assert.equal(utilised(app, bank.BankAccountId), 200000);
    app.api(app.superToken()).closeAndReleaseLoan(loan.LoanId, '');
    assert.equal(utilised(app, bank.BankAccountId), 0);
  });

  test('closing one loan does not release another loan\'s ornaments', () => {
    const app = loadBackend();
    const s = app.scenario();
    const l1 = app.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanAmount: 10000, ornamentIds: [s.orn1.OrnamentId] });
    app.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanAmount: 10000, ornamentIds: [s.orn2.OrnamentId] });
    app.api(app.superToken()).closeAndReleaseLoan(l1.LoanId, '');
    assert.equal(ornamentStatus(app, s.orn1.OrnamentId), 'Released');
    assert.equal(ornamentStatus(app, s.orn2.OrnamentId), 'Pledged');
  });

  test('released ornaments can be pledged again on a new loan', () => {
    const { app, user, bank, orn1, loan } = setup();
    const api = app.api(app.superToken());
    api.closeAndReleaseLoan(loan.LoanId, '');
    const again = api.addLoan(app.seed.loanPayload({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 50000, ornamentIds: [orn1.OrnamentId] }));
    assert.equal(again.success, true);
    assert.equal(ornamentStatus(app, orn1.OrnamentId), 'Pledged');
  });

  test('getActiveLoansForClosure lists only active loans with customer, mobile and ornament names', () => {
    const { app, user, bank, loan, orn1 } = setup();
    const api = app.api(app.superToken());
    const rows = api.getActiveLoansForClosure().data;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].customerName, 'Asha Rao');
    assert.equal(rows[0].mobileNumber, '9990001111');
    assert.equal(rows[0].BankName, 'SBI');
    assert.equal(rows[0].linkedOrnaments, 'Chain, Bangle');
    api.closeAndReleaseLoan(loan.LoanId, '');
    assert.deepEqual(api.getActiveLoansForClosure().data, []);
    void user; void bank; void orn1;
  });

  test('a read-only User cannot close a loan', () => {
    const { app, loan } = setup();
    assert.equal(app.api(app.viewerToken()).closeAndReleaseLoan(loan.LoanId, '').code, 403);
    assert.equal(app.table('Loans')[0].LoanStatus, 'Active');
  });
});
