# Calculation Logic Reference

This document records every formula the Gold Loan Tracker actually computes,
where it lives in the code, and what it does **not** compute (so assumptions
don't silently creep in). Keep this file updated whenever a formula changes.

---

## 1. Loan Charges & Net Disbursement

**Where:** [`calculateLoanCharges()`](index.html) — runs live in the Add/Edit
Loan form as the user types Amount / Interest Rate / Interest Type / Loan
Period / Loan Date / Due Date / Processing Fee / Document Charge / Insurance
Charge. The same formula is used in the Loan Detail/View screen
(`viewLoanDetail()`), so **Total Charges is now identical on both screens.**

```
Total Charges       = Interest (see §2) + Processing Fee
Net Disbursement    = Loan Amount − (Processing Fee + Document Charge + Insurance Charge)
```

- **Total Charges is a display/reporting figure** — it is what gets saved to
  the `TotalCharges` column, but it no longer feeds into Net Disbursement.
- **Net Disbursement deliberately does not subtract interest** — only the
  upfront Processing/Document/Insurance charges are deducted from what's
  actually paid out to the customer at disbursement. This was a explicit
  product decision (interest accrues over the loan term, it isn't deducted
  upfront), not an oversight.
- Fixed on 2026-09-12: previously the Edit form computed
  `Total Charges = Processing Fee + Document Charge + Insurance Charge`
  (no interest, and it was also what Net Disbursement subtracted), while the
  View screen computed `Total Charges = Interest + Processing Fee` — the two
  screens disagreed for the same loan. Both now use the formula above.
- Purely additive/subtractive — no rounding rules beyond `toFixed(2)` on
  display.
- The backend (`createLoan`/`updateLoan` in `code.js`) does **not**
  recompute or validate `TotalCharges`/`NetDisbursementAmount` server-side —
  it just `parseFloat`s whatever the client sent.

---

## 2. Loan Interest (Simple / Compound)

**Where:** [`calculateLoanPeriodInterest(loan)`](index.html) — used both in
the Loan Detail/View screen and (as of the fix above) live in the Add/Edit
Loan form for the Total Charges figure. Not stored on the Loans sheet as its
own column; it's derived on demand.

**Step 1 — resolve the loan term in months:**
```
months = LoanPeriod                                   (if set)
       else round((DueDate − LoanDate) in days / 30.4375)   (min 1)
       else 1                                          (last-resort default)
```
`30.4375` = average days/month (365.25 / 12), used only when `LoanPeriod`
itself is blank and both dates are present.

**Step 2 — apply the rate per `InterestType`:**

Simple interest (default):
```
Interest = Principal × (Rate / 100) × (months / 12)
```

Compound interest (monthly compounding):
```
monthlyRate = Rate / (12 × 100)
Interest    = Principal × (1 + monthlyRate)^months − Principal
```
Both results are rounded to 2 decimals (`Math.round(x * 100) / 100`).

- **Note:** `DueDate` itself is a manually entered field on the loan form —
  it is *not* auto-calculated from `LoanDate + LoanPeriod`. If a user changes
  `LoanPeriod` without updating `DueDate` to match, this formula's day-count
  fallback path won't trigger (since `LoanPeriod` is already set), but the
  displayed due date and the interest period can drift out of sync.
- **Note:** Payments are recorded as free-form amounts tagged with a
  `PaymentType` (EMI / partial / full / etc.) — there is no automatic
  principal/interest/penalty split calculated from a payment amount. Any
  such breakdown is whatever the person recording the payment enters.

---

## 3. Bank Account Utilization & Available Limit

**Where:** [`calculateUserBankUtilization()`](code.js) and
[`getDashboardData()`](code.js) / [`getBankAccounts()`](code.js).

```
Utilized Loan Amount (per user+bank account)
    = Σ LoanAmount, over that user's Active loans on that bank account

Available Limit = max(0, MaxLoanAmount − Utilized Loan Amount)
```
- `Closed` loans do not count toward utilization.
- `BankAccounts.UtilizedLoanAmount` is kept in sync by
  `recalculateAndSyncBankUtilization()`, which re-derives it from Active
  loans and writes it back only if it has drifted from the stored value.

---

## 4. Dashboard Gold Valuation Cards

**Where:** [`updateGoldValuationDashboardCards()`](index.html), fed by
`getDashboardData()` ([code.js](code.js)) server-side, with a client-side
fallback recomputation from `getOrnaments()` if the server payload is stale
(and again whenever the Ornaments table itself reloads, so edits stay in
sync — see `loadOrnaments()`).

### Per-ornament Gold Weight
```
weight = MetalWeight                          (if > 0)
       else NetWeight                         (if > 0)
       else max(0, GrossWeight − StoneWeight)
```
[`getOrnamentGoldWeight()`](index.html), mirrored server-side in
`getDashboardData()`.

### Per-ornament Buying Rate
```
rate = BuyingPricePerGram
     else BuyingPrice
     else "Buying price/grm" (legacy column)
```
[`getOrnamentBuyingRate()`](index.html).

### 🏆 Current Gold Value
```
Current Gold Value = Live Gold Rate (₹/g, 22K*) × Total Gold Weight (g)
```
Rounded with `Math.round`. *Falls back to the 24K live rate only if the 22K
figure wasn't available from the scraper.* Total Gold Weight = sum of every
non-deleted ornament's weight (formula above).

### 🏷️ Buying Gold Value
```
Buying Gold Value = Σ over all ornaments of:
                       (Buying Rate/g × Gold Weight)   if both > 0
                       else that ornament's TotalPrice
                       else 0
```

### 📈 Appreciation / Gains
```
Appreciation      = Current Gold Value − Buying Gold Value
% vs Buying Value = (Appreciation ÷ Buying Gold Value) × 100
                    — only shown when Buying Gold Value > 0
```
Color: emerald if positive, red if negative, neutral gray if exactly zero.

**Known data gap:** if every ornament is missing both a buying
rate/price *and* a `TotalPrice`, Buying Gold Value computes to a real ₹0 —
this has been observed in practice (21 ornaments, ₹0 buying value). It's a
data-entry gap, not a formula bug; Appreciation will simply mirror Current
Gold Value 1:1 until buying prices are backfilled.

---

## 5. Live Gold Rate Tracker — what's a calculation vs. what's scraped

**Where:** [`getGoldRates()`](code.js) / [`parseGoldRatesHtml()`](code.js).

- **There is no karat-conversion formula.** 24K, 22K, and 18K prices are
  each independently **scraped** from `goodreturns.in/gold-rates/bangalore.html`
  (their own table columns / DOM ids) — the app does **not** derive 22K or
  18K from 24K via the standard purity ratios (22K ≈ 24K × 22/24 ≈ 0.9167,
  18K = 24K × 0.75). The "99.9% / 91.6% (916) / 75.0%" badges are static
  labels, not variables used in any computation.
- **"Daily Change" badges are extracted, not computed** — they reproduce
  whichever delta figure GoodReturns' own page already shows for that karat
  (via regex + CSS-class sniffing for direction), not a local
  `today − yesterday` subtraction. The badge is an absolute ₹ amount
  (e.g. `+ 50 ▲`), never a percentage.
- **Caching:** results cached 30 minutes (`CacheService`, TTL 1800s) with a
  `PropertiesService` last-known-good fallback if a live fetch fails.
- **Suggested improvement (not yet implemented):** a sanity check that
  rejects a scraped 22K/18K price whose ratio to 24K falls outside a
  plausible band (~0.70–0.95), to catch a markup change on the source site
  silently corrupting the cached rate for 30 minutes.

---

## 6. Table Pagination Math

**Where:** [`tablePagination.update()`](index.html) — not financial, but
included here since it's the other place the app does arithmetic on live
data.

```
totalPages = ceil(matchingRowCount / pageSize)   (min 1)
startIndex = (currentPage − 1) × pageSize
endIndex   = min(startIndex + pageSize, matchingRowCount)
```
Rows outside `[startIndex, endIndex)` of the filtered set are hidden via
`display: none`. (Previously broken because `window.tablePagination` was
never assigned — see git history; fixed by explicitly exposing it on
`window`.)

---

## Change log

| Date | Change |
| --- | --- |
| 2026-09-12 | Initial version — documents loan charges/interest, bank utilization, dashboard gold valuation cards, live gold rate scraping, and pagination math as they exist in `code.js` / `index.html`. |
| 2026-09-12 | Fixed Total Charges inconsistency between the Add/Edit Loan form and the Loan Detail/View screen — both now compute `Interest + Processing Fee`. Net Disbursement formula intentionally left unchanged (`Loan Amount − Processing/Document/Insurance charges`), per explicit decision to keep interest out of the disbursed amount. |
