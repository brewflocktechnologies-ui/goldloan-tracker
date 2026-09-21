'use strict';
const { test, expect } = require('./fixtures');

const SAVE_ORNAMENT = 'button[onclick="submitOrnament(this)"]';
const SAVE_LOAN = 'button[onclick="submitLoan(this)"]';

test.describe('ornaments screen', () => {
  test('the form works out weights, cost and value as you type, then saves the ornament', async ({ app }) => {
    const { page, backend } = app;
    backend.seed.user({ FullName: 'Asha Rao' });
    app.useGoldRates();
    await app.open();
    await app.login();
    await expect(page.locator('#gold-price-22k')).toContainText('9,020'); // live rate has arrived
    await app.go('ornaments');

    await page.locator('#btn-add-ornament').click();
    await expect(page.locator('#ornamentModal')).toBeVisible();
    await page.locator('#ornUserId').selectOption('U001');
    await page.locator('#ornName').fill('Gold Chain');
    await page.locator('#ornGrossWeight').fill('10');
    await page.locator('#ornStoneWeight').fill('1.5');
    await page.locator('#ornBuyingPrice').fill('6000');

    await expect(page.locator('#ornMetalWeight')).toHaveValue('8.5'); // gross - stone
    await expect(page.locator('#ornNetWeight')).toHaveValue('8.5');
    await expect(page.locator('#ornCurrentPrice')).toHaveValue('9020'); // pre-filled from the live 22K rate
    await expect(page.locator('#ornBuyingCost')).toHaveValue('51000'); // 8.5 g x 6000
    await expect(page.locator('#ornMarketValue')).toHaveValue('76670'); // 8.5 g x 9020
    await expect(page.locator('#ornAppreciationValue')).toHaveValue('+₹25,670.00');
    await expect(page.locator('#ornAppreciationPercentage')).toHaveValue('+50.33%');

    await page.locator(SAVE_ORNAMENT).click();
    await expect(app.toast()).toContainText('added successfully');
    await expect(page.locator('#ornamentModal')).toBeHidden();

    const row = app.rows('ornamentsTable').first();
    await expect(row).toContainText('ORN001');
    await expect(row).toContainText('Gold Chain');
    await expect(row).toContainText('Available');

    const saved = backend.table('Ornaments')[0];
    expect([saved.UserId, saved.OrnamentName, saved.GrossWeight, saved.StoneWeight, saved.MetalWeight, saved.BuyingCost, saved.MarketValue, saved.Status])
      .toEqual(['U001', 'Gold Chain', 10, 1.5, 8.5, 51000, 76670, 'Available']);
  });

  test('changing purity re-prices from the matching live rate', async ({ app }) => {
    const { page } = app;
    app.useGoldRates();
    await app.open();
    await app.login();
    await expect(page.locator('#gold-price-24k')).toContainText('9,850');
    await app.go('ornaments');
    await page.locator('#btn-add-ornament').click();
    await page.locator('#ornGrossWeight').fill('10');

    await page.locator('#ornPurity').selectOption('24K');
    await expect(page.locator('#ornCurrentPrice')).toHaveValue('9850');
    await page.locator('#ornPurity').selectOption('18K');
    await expect(page.locator('#ornCurrentPrice')).toHaveValue('7380');
    await expect(page.locator('#ornMarketValue')).toHaveValue('73800'); // 10 g x 7380
  });

  test('deleting an ornament asks first, then removes it from the list', async ({ app }) => {
    const { page, backend } = app;
    backend.seed.ornament({ OrnamentName: 'Spare Ring' });
    await app.open();
    await app.login();
    await app.go('ornaments');

    await app.rows('ornamentsTable').first().getByTitle('Delete').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.locator('#confirmModalConfirmBtn').click();
    await expect(app.toast()).toContainText('Ornament deleted.');
    await expect(app.rows('ornamentsTable')).toHaveCount(0);
    expect(backend.table('Ornaments')[0].Status).toBe('Deleted');
  });
});

test.describe('loans screen', () => {
  /** Fills the Add Loan form up to (not including) the save button. */
  async function fillLoanForm(page, { amount = '100000', ornamentId = 'ORN001' } = {}) {
    await page.locator('#loanUserId').selectOption('U001');
    await page.locator('#loanBankAccountId').selectOption('BA001');
    await page.locator('#loanNumber').fill('LN-0001');
    await page.locator('#loanDueDate').fill('2027-03-01');
    await page.locator('#loanAmount').fill(amount);
    await page.locator('#loanInterestRate').fill('12');
    await page.locator('#loanPeriod').fill('6');
    await page.locator('#loanProcessingFee').fill('500');
    if (ornamentId) await page.locator(`#chk-orn-${ornamentId}`).check();
  }

  test('creating a loan through the form pledges the ornament and books the bank limit', async ({ app }) => {
    const { page, backend } = app;
    backend.scenario(); // customer, bank account (limit 5,00,000), two ornaments (10 g and 20 g)
    await app.open();
    await app.login();
    await app.go('loans');

    await page.locator('#btn-add-loan').click();
    await expect(page.locator('#loanModal')).toBeVisible();
    await fillLoanForm(page);

    await expect(page.locator('#loanBankLimitInfo')).toContainText('5,00,000');
    await expect(page.locator('#loanGrossWeight')).toHaveValue('10'); // from the ticked ornament
    await expect(page.locator('#loanTotalCharges')).toHaveValue('6500.00'); // 6,000 interest + 500 fee
    await expect(page.locator('#loanNetDisbursementAmount')).toHaveValue('99500.00'); // 1,00,000 - 500

    await page.locator(SAVE_LOAN).click();
    await expect(app.toast()).toContainText('Loan added successfully');
    await expect(page.locator('#loanModal')).toBeHidden();

    const row = app.rows('loansTable').first();
    await expect(row).toContainText('L001');
    await expect(row).toContainText('₹1,00,000');
    await expect(row).toContainText('Active');

    const loan = backend.table('Loans')[0];
    expect([loan.LoanNumber, loan.LoanAmount, loan.LoanStatus, loan.BankName]).toEqual(['LN-0001', 100000, 'Active', 'SBI']);
    expect(backend.table('Ornaments')[0].Status).toBe('Pledged');
    expect(backend.table('BankAccounts')[0].UtilizedLoanAmount).toBe(100000);

    await app.go('ornaments');
    await expect(app.rows('ornamentsTable').filter({ hasText: 'ORN001' })).toContainText('Pledged');
  });

  test('a loan above the bank limit is refused with a clear message and nothing is saved', async ({ app }) => {
    const { page, backend } = app;
    const user = backend.seed.user();
    backend.seed.bank(user.UserId, { MaxLoanAmount: 50000 });
    backend.seed.ornament({ UserId: user.UserId });
    await app.open();
    await app.login();
    await app.go('loans');

    await page.locator('#btn-add-loan').click();
    await fillLoanForm(page, { amount: '60000' });
    await page.locator(SAVE_LOAN).click();

    await expect(app.toast()).toContainText('exceeds the available limit of ₹50,000');
    await expect(page.locator('#loanModal')).toBeVisible();
    expect(backend.table('Loans')).toHaveLength(0);
    expect(backend.table('Ornaments')[0].Status).toBe('Available');
  });

  test('a loan cannot be saved without choosing an ornament to pledge', async ({ app }) => {
    const { page, backend } = app;
    backend.scenario();
    await app.open();
    await app.login();
    await app.go('loans');

    await page.locator('#btn-add-loan').click();
    await fillLoanForm(page, { ornamentId: null });
    await page.locator(SAVE_LOAN).click();

    await expect(app.toast()).toContainText('at least one ornament');
    expect(backend.table('Loans')).toHaveLength(0);
  });

  test('required fields are checked before saving', async ({ app }) => {
    const { page, backend } = app;
    backend.scenario();
    await app.open();
    await app.login();
    await app.go('loans');

    await page.locator('#btn-add-loan').click();
    await page.locator('#chk-orn-ORN001').check(); // has an ornament, but no customer / bank / number / amount
    await page.locator(SAVE_LOAN).click();

    await expect(app.toast()).toContainText('required');
    expect(backend.table('Loans')).toHaveLength(0);
  });

  test('editing a loan loads its values and saves the new amount, updating the limit', async ({ app }) => {
    const { page, backend } = app;
    const s = backend.scenario();
    backend.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanNumber: 'LN-0001', LoanAmount: 100000, ornamentIds: [s.orn1.OrnamentId] });
    await app.open();
    await app.login();
    await app.go('loans');

    await app.rows('loansTable').first().getByTitle('Edit').click();
    await expect(page.locator('#loanModal')).toBeVisible();
    await expect(page.locator('#loanNumber')).toHaveValue('LN-0001');
    await expect(page.locator('#loanAmount')).toHaveValue('100000');
    await expect(page.locator('#chk-orn-ORN001')).toBeChecked();

    await page.locator('#loanAmount').fill('150000');
    await page.locator(SAVE_LOAN).click();

    await expect(app.toast()).toContainText('Loan updated successfully');
    await expect(app.rows('loansTable').first()).toContainText('₹1,50,000');
    expect(backend.table('Loans')[0].LoanAmount).toBe(150000);
    expect(backend.table('BankAccounts')[0].UtilizedLoanAmount).toBe(150000);
    expect(backend.table('Loans')[0].LoanNumber).toBe('LN-0001');
  });

  test('a loan past its due date is flagged OVERDUE', async ({ app }) => {
    const { backend } = app;
    const s = backend.scenario();
    backend.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanDate: '2024-01-01', DueDate: '2024-07-01', ornamentIds: [s.orn1.OrnamentId] });
    await app.open();
    await app.login();
    await app.go('loans');

    await expect(app.rows('loansTable').first()).toContainText('OVERDUE');
  });

  test('the loan detail view shows terms, pledged ornament and payments', async ({ app }) => {
    const { page, backend } = app;
    const s = backend.scenario();
    const loan = backend.seed.loan({ UserId: s.user.UserId, BankAccountId: s.bank.BankAccountId, LoanNumber: 'LN-0001', ornamentIds: [s.orn1.OrnamentId] });
    backend.api(backend.superToken()).addPayment({ LoanId: loan.LoanId, PaymentDate: '2026-10-01', PaymentType: 'Interest', InterestAmount: 1000, TotalPaidAmount: 1000, PaymentMethod: 'UPI' });
    await app.open();
    await app.login();
    await app.go('loans');

    await app.rows('loansTable').first().getByTitle('View').click();
    const modal = page.locator('#detailViewModal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Loan Reference: LN-0001');
    await expect(modal).toContainText('Asha Rao');
    await expect(modal).toContainText('₹1,00,000');
    await expect(modal).toContainText('Chain'); // pledged ornament
    await expect(modal).toContainText('Payments Made (1)');
    await expect(modal).toContainText('UPI');
  });
});
