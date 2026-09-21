'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend');

describe('payments', () => {
  const withLoan = () => {
    const app = loadBackend();
    const s = app.scenario();
    const loan = app.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, ornamentIds: [s.orn1.OrnamentId] });
    return { app, loan, api: app.api(app.superToken()) };
  };

  test('records a payment with the defaults the form relies on', () => {
    const { app, loan, api } = withLoan();
    const res = api.addPayment({ LoanId: loan.LoanId, PaymentDate: '2026-10-01', TotalPaidAmount: '1500' });
    assert.equal(res.success, true);
    assert.equal(res.data.PaymentId, 'PAY001');
    const row = app.table('Payments')[0];
    assert.equal(row.PaymentType, 'Partial');
    assert.equal(row.PaymentMethod, 'Cash');
    assert.equal(row.TotalPaidAmount, 1500);
    assert.equal(row.PrincipalAmount, 0);
    assert.ok(row.CreatedDate);
  });

  test('stores the principal / interest / penalty breakdown, method and reference as entered', () => {
    const { app, loan, api } = withLoan();
    api.addPayment({
      LoanId: loan.LoanId, PaymentDate: '2026-10-01', PaymentType: 'Interest', PrincipalAmount: 0, InterestAmount: 1000, PenaltyAmount: 50,
      TotalPaidAmount: 1050, PaymentMethod: 'UPI', TransactionReference: 'UTR123', Remarks: 'Oct interest',
    });
    const row = app.table('Payments')[0];
    assert.deepEqual(
      [row.PaymentType, row.InterestAmount, row.PenaltyAmount, row.TotalPaidAmount, row.PaymentMethod, row.TransactionReference, row.Remarks],
      ['Interest', 1000, 50, 1050, 'UPI', 'UTR123', 'Oct interest'],
    );
  });

  test('getPayments returns all payments, or only those of one loan', () => {
    const app = loadBackend();
    const s = app.scenario();
    const l1 = app.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanAmount: 1000, ornamentIds: [s.orn1.OrnamentId] });
    const l2 = app.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanAmount: 1000, ornamentIds: [s.orn2.OrnamentId] });
    const api = app.api(app.superToken());
    api.addPayment({ LoanId: l1.LoanId, PaymentDate: '2026-10-01', TotalPaidAmount: 1 });
    api.addPayment({ LoanId: l2.LoanId, PaymentDate: '2026-10-02', TotalPaidAmount: 2 });
    api.addPayment({ LoanId: l2.LoanId, PaymentDate: '2026-10-03', TotalPaidAmount: 3 });
    assert.equal(api.getPayments().data.length, 3);
    assert.deepEqual(api.getPayments(l2.LoanId).data.map(p => p.TotalPaidAmount), [2, 3]);
    assert.deepEqual(api.getPayments('L999').data, []);
  });

  test('a read-only User can view payments but not record them', () => {
    const { app, loan } = withLoan();
    const viewer = app.api(app.viewerToken());
    assert.equal(viewer.getPayments().success, true);
    assert.equal(viewer.addPayment({ LoanId: loan.LoanId, TotalPaidAmount: 1 }).code, 403);
    assert.equal(app.table('Payments').length, 0);
  });
});

describe('dashboard', () => {
  test('an empty book reports zeros', () => {
    const app = loadBackend();
    const d = app.api(app.superToken()).getDashboardData().data;
    assert.equal(d.totalUsers, 0);
    assert.equal(d.activeLoans, 0);
    assert.equal(d.totalLoanAmount, 0);
    assert.equal(d.totalGoldWeight, 0);
    assert.deepEqual(d.recentTransactions, []);
  });

  test('counts, loan totals, limits and gold value add up', () => {
    const app = loadBackend();
    const user = app.seed.user();
    const bank = app.seed.bank(user.UserId, { MaxLoanAmount: 500000 });
    const o1 = app.seed.ornament({ UserId: user.UserId, GrossWeight: 10, BuyingPricePerGram: 6000 });
    app.seed.ornament({ UserId: user.UserId, GrossWeight: 20, BuyingPricePerGram: 6000 });
    app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, LoanAmount: 100000, ornamentIds: [o1.OrnamentId] });

    const d = app.api(app.superToken()).getDashboardData().data;
    assert.equal(d.totalUsers, 1);
    assert.equal(d.totalBankAccounts, 1);
    assert.equal(d.totalOrnaments, 2);
    assert.equal(d.activeLoans, 1);
    assert.equal(d.closedLoans, 0);
    assert.equal(d.totalLoanAmount, 100000);
    assert.equal(d.totalEligibleLoanAmount, 500000);
    assert.equal(d.totalAvailableLoanAmount, 400000);
    assert.equal(d.pledgedOrnamentsCount, 1);
    assert.equal(d.pledgedGrams, 10);
    assert.equal(d.totalGoldWeight, 30);
    assert.equal(d.totalBuyingGoldValue, 180000); // 30 g x 6000
  });

  test('closing a loan moves it from active to closed and drops it from the loan total', () => {
    const app = loadBackend();
    const s = app.scenario();
    const loan = app.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanAmount: 100000, ornamentIds: [s.orn1.OrnamentId] });
    const api = app.api(app.superToken());
    api.closeAndReleaseLoan(loan.LoanId, '');
    const d = api.getDashboardData().data;
    assert.equal(d.activeLoans, 0);
    assert.equal(d.closedLoans, 1);
    assert.equal(d.totalLoanAmount, 0);
    assert.equal(d.pledgedOrnamentsCount, 0);
  });

  test('deleted customers, accounts and ornaments are not counted', () => {
    const app = loadBackend();
    const s = app.scenario();
    const api = app.api(app.superToken());
    api.deleteUser(s.user.UserId);
    api.deleteBankAccount(s.bank.BankAccountId);
    api.deleteOrnament(s.orn1.OrnamentId);
    const d = api.getDashboardData().data;
    assert.equal(d.totalUsers, 0);
    assert.equal(d.totalBankAccounts, 0);
    assert.equal(d.totalOrnaments, 1);
  });

  test('recent transactions are the latest five payments, newest first', () => {
    const app = loadBackend();
    const s = app.scenario();
    const loan = app.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, ornamentIds: [s.orn1.OrnamentId] });
    const api = app.api(app.superToken());
    for (let i = 1; i <= 7; i++) api.addPayment({ LoanId: loan.LoanId, PaymentDate: `2026-10-0${i}`, TotalPaidAmount: i });
    const recent = api.getDashboardData().data.recentTransactions;
    assert.deepEqual(recent.map(p => p.TotalPaidAmount), [7, 6, 5, 4, 3]);
  });

  test('getInitialSyncData bundles everything the app loads at start-up', () => {
    const app = loadBackend();
    app.fake.setFetch(() => { throw new Error('offline'); });
    app.scenario();
    const res = app.api(app.superToken()).getInitialSyncData();
    assert.equal(res.success, true);
    assert.deepEqual(Object.keys(res.data).sort(), ['bankAccounts', 'goldRates', 'loans', 'ornaments', 'payments', 'timestamp', 'users']);
    assert.equal(res.data.users.length, 1);
    assert.equal(res.data.ornaments.length, 2);
  });
});

describe('live gold rates', () => {
  const PAGE = `<html><body><table>
    <thead><tr><th>Gram</th><th>24K Gold</th><th>22K Gold</th><th>18K Gold</th></tr></thead>
    <tbody>
      <tr><td>1 Gram</td>
        <td>₹9,850 <span class="gr-change gr-change-up">+50</span></td>
        <td>₹9,020 <span class="gr-change gr-change-down">-40</span></td>
        <td>₹7,380 <span class="gr-change">0</span></td></tr>
      <tr><td>8 Gram</td><td>₹78,800</td><td>₹72,160</td><td>₹59,040</td></tr>
    </tbody></table></body></html>`;
  const ok = html => () => ({ getResponseCode: () => 200, getContentText: () => html });
  const status = code => () => ({ getResponseCode: () => code, getContentText: () => '' });

  test('parses the 1-gram row for 24K, 22K and 18K with price and daily change', () => {
    const app = loadBackend();
    app.fake.setFetch(ok(PAGE));
    const res = app.api(app.superToken()).getGoldRates(true);
    assert.equal(res.success, true);
    assert.equal(res.isFallback, undefined);
    const { gold24k, gold22k, gold18k } = res.data;
    assert.deepEqual([gold24k.rate1g, gold22k.rate1g, gold18k.rate1g], [9850, 9020, 7380]);
    assert.deepEqual([gold24k.direction, gold22k.direction, gold18k.direction], ['up', 'down', 'flat']);
    assert.deepEqual([gold24k.change, gold22k.change, gold18k.change], [50, -40, 0]);
  });

  test('serves from the cache for repeat calls, and refetches when forced', () => {
    const app = loadBackend();
    app.fake.setFetch(ok(PAGE));
    const api = app.api(app.superToken());
    api.getGoldRates(false);
    const cached = api.getGoldRates(false);
    assert.equal(cached.isCached, true);
    assert.equal(app.fake.fetchCalls.length, 1);
    api.getGoldRates(true);
    assert.equal(app.fake.fetchCalls.length, 2);
  });

  test('when the site is down it falls back to the last good rates and says so', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    app.fake.setFetch(ok(PAGE));
    api.getGoldRates(true);
    app.fake.setFetch(status(503));
    const res = api.getGoldRates(true);
    assert.equal(res.success, true);
    assert.equal(res.isFallback, true);
    assert.match(res.warning, /Live server unreachable/);
    assert.equal(res.data.gold22k.rate1g, 9020);
  });

  test('when the page layout changes and nothing was saved it returns the built-in baseline, flagged as a fallback', () => {
    const app = loadBackend();
    app.fake.setFetch(ok('<html><body>redesigned</body></html>'));
    const res = app.api(app.superToken()).getGoldRates(true);
    assert.equal(res.success, true);
    assert.equal(res.isFallback, true);
    assert.ok(res.warning);
    assert.equal(res.data.location, 'Bangalore');
    assert.ok(res.data.gold22k.rate1g > 0);
  });

  test('a read-only User can read the rates', () => {
    const app = loadBackend();
    app.fake.setFetch(ok(PAGE));
    assert.equal(app.api(app.viewerToken()).getGoldRates(false).success, true);
  });
});
