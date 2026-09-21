# Gold Loan Tracker

A web-based gold loan management system built on **Google Apps Script + Google Sheets + Google Drive**. It manages customers, bank accounts, ornaments, loans, payments, and loan closure/release of ornaments.

## Live URLs

**Front-end domain (Gold Loan Tracker portal):** https://goldloan.brewflock.com/

**Apps Script web app URL:** https://script.google.com/macros/s/AKfycbyReA2hwoWcTOlPH9qwHrCD2FW7y8MC2UNX2KXTMD0b7f9uCXSYsMNV8JWvEwO5Bg8/exec

Currently, `goldloan.brewflock.com` loads the Apps Script web app inside an iframe. The web app is deployed with `XFrameOptionsMode.ALLOWALL`, so it can be embedded on any domain.

> The domain `https://goldloan.brewflock.com/` loads the Apps Script web app inside an iframe. The web app is deployed with `XFrameOptionsMode.ALLOWALL`, so it is embeddable on any domain.

## Default Login Credentials

The system seeds one default admin account the **first time** the sheets are initialized (`setupSheets()` is run).

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `password123` | SuperAdmin |

> **IMPORTANT:** Change the default password immediately after first login (Admin Login Accounts screen, as SuperAdmin). Do not edit the `Password` column of the **Admins** sheet by hand: it stores SHA-256 hashes, not plain text, so a typed-in password will not match.

## How It Works (Architecture)

```
Browser (index.html)
   │  google.script.run.authenticateAdmin(...)
   ▼
code.js — runs on Google's servers
   │
   ├── Google Sheets ── data storage (8 sheets)
   └── Google Drive ── uploaded files (photos, passbook, ornament images, delivery proofs)
```

- The UI is a single-page HTML app (`index.html`) built with **Tailwind CSS**, **Chart.js**, and **SweetAlert2**.
- The backend (`code.js`) exposes functions callable from the browser via `google.script.run`.
- `doGet(e)` (in `code.js`) serves `index.html` when the web app URL is opened.

## Google Sheet Structure

`setupSheets()` creates these 8 sheets with headers:

| Sheet | Purpose |
| --- | --- |
| Admins | Login accounts (`admin` / `password123` seeded) |
| Users | Customer master data + photo |
| BankAccounts | Customer bank accounts, UPI, max & utilized loan limits |
| Ornaments | Gold ornaments with weights, purity, value, images |
| Loans | Loan records, charges, disbursement, due dates |
| LoanOrnaments | Mapping of ornaments pledged against a loan |
| Payments | EMI / partial / full payments on loans |
| Releases | Ornament release records on loan closure |

File uploads are stored in a Drive folder `GoldLoanApp_Uploads` (auto-created) with sub-folders `Customer_Photos`, `Passbook_Images`, `Ornament_Images`, `Delivery_Proofs`.

## Setup in Google Apps Script (Step by Step)

> Note: `code.js` uses `SpreadsheetApp.getActiveSpreadsheet()`, so the script **must be bound to a Google Spreadsheet** — you cannot create a standalone script.

1. **Create a Google Sheet**
   - Go to https://sheets.new and create a blank spreadsheet. Name it e.g. `Gold Loan Tracker`.

2. **Open the Apps Script editor**
   - In the spreadsheet, go to **Extensions → Apps Script**.

3. **Paste the code files**
   - Delete the default `Code.gs` content and paste the contents of **`code.js`** into it.
   - Click **+** next to "Files" → **HTML** → name it `index` — paste the contents of **`index.html`** into it.
   - (Save with `Ctrl+S` or click the save icon.)

4. **Run `setupSheets` (one-time setup)**
   - In the editor toolbar, select the function **`setupSheets`** from the dropdown and click **Run**.
   - A dialog will ask for permissions — click **Review permissions**, choose your Google account, and click **Allow**.
   - This creates all 8 sheets with headers and seeds the default admin `admin` / `password123`.

5. **Deploy as a web app**
   - In the Apps Script editor click **Deploy → New deployment**.
   - Click the gear icon (⚙️) and set:
     - **Type:** Web app
   - Fill in:
     - **Description:** e.g. `Gold Loan Tracker` (optional)
     - **Execute as:** *Me* (you)
     - **Who has access:** *Anyone*
   - Click **Deploy** and authorize when prompted.
   - Copy the **Web app URL** (ends in `/exec`). This is your deployment URL, e.g.:
     `https://script.google.com/macros/s/.../exec`

6. **Access the app**
   - Open the deployment URL directly, **or** load it inside your domain: `https://goldloan.brewflock.com/`.
   - Log in with the default credentials above.

> Every time you edit `code.js` or `index.html`, you must **Deploy → Manage deployments → Edit (pencil icon) → Version: New version → Deploy** for changes to go live.

## Application Flow

1. **Login** — Admin enters username/password → `authenticateAdmin()` checks the `Admins` sheet → session stored in `sessionStorage`.
2. **Dashboard** — Shows totals: active users, bank accounts, ornaments, active/closed loans, total outstanding loan amount, and recent transactions.
3. **User Management** — Add/update/delete customers (KYC details + photo). Deletion is soft (status → `Deleted`).
4. **Bank Accounts** — Add/update accounts per customer, including `MaxLoanAmount` and `UtilizedLoanAmount` (auto-tracked as loans are opened/closed).
5. **Ornaments** — Add gold ornaments (weight, purity, images, estimated/market value). Ornament statuses: `Available` → `Pledged` → `Released`.
6. **Loans**
   - Create a loan: pick customer + bank account, enter amount, interest, charges → net disbursement computed.
   - Select ornaments to pledge → they are marked `Pledged` and linked via the `LoanOrnaments` mapping.
   - Bank account `UtilizedLoanAmount` increases by the loan amount.
   - Record payments against the loan (principal / interest / penalty).
7. **Loan Closure / Release** — Close an active loan → ornaments are marked `Released` (given back), mapping status updated, and `UtilizedLoanAmount` is reduced. Release proof (image/signature) can be attached.

## Security Notes

- **Server-side auth:** the browser can only reach the server through `rpc(token, action, args)`, which validates the session token and role on every call. All other functions in `code.js` end in `_` (private to Apps Script) and cannot be called from the browser console. Only `doGet`, `doPost`, `authenticateAdmin`, `logoutAdmin` and `rpc` are public. If you add a new server function, give it a trailing `_` and register it in `RPC_ACTIONS_` (and in `USER_ROLE_ACTIONS_` if the read-only role may use it).
- `setupSheets`, `testGoldRates` and `migrateAdminPasswordsToHashed` are run from the editor and refuse anyone but the script owner.
- Passwords are stored as unsalted SHA-256 hashes in the `Admins` sheet — restrict spreadsheet sharing to authorized people only, and change the default `admin` / `password123` login.
- The web app uses `XFrameOptionsMode.ALLOWALL`, which is what makes embedding on `goldloan.brewflock.com` possible.
- Session is kept only in `sessionStorage` (cleared on logout/browser close).

## Automated tests

The backend (`code.js`) and the UI/server contract are covered by tests that run in Node against an in-memory fake of Google Sheets, Drive and the other Apps Script services. No installs, no Google account, about a second to run. Browser tests for the UI are described further down.

```
npm test          # readable output; known bugs shown as one line each
npm run test:raw  # Node's default output, with full details for known bugs too
```

| File | Covers |
| --- | --- |
| `tests/auth.test.js` | Login, lockout, sessions, roles, privilege-escalation regressions, REST endpoint |
| `tests/users.test.js`, `bank-accounts.test.js`, `ornaments.test.js` | Create / read / update / delete, derived values, Drive uploads |
| `tests/loans.test.js` | Loan rules: limits, pledging, editing, closing and releasing |
| `tests/payments-dashboard.test.js` | Payments, dashboard totals, gold-rate parsing and fallback |
| `tests/contract.test.js` | UI, server and mobile app agree on action names; nothing leaks to the browser |
| `tests/known-bugs.test.js` | Known bugs written as the behaviour we want, marked `todo` until fixed |

- **Before you paste into Apps Script:** run `npm test`. To check a candidate copy of the script, run `GOLDLOAN_CODE_PATH=path/to/Code.gs npm test`.
- **A `todo` test that starts passing** means a known bug got fixed: delete its `todo` option so it becomes a permanent regression test.
- **What this cannot catch:** behaviour that only exists in real Google services (e.g. how Sheets stores dates, Drive permissions, quotas). Click through the app once after a deploy.

### Browser (UI) tests

`ui-tests/` drives the real `index.html` in a real Chromium browser with Playwright. A small shim replaces `google.script.run` and forwards each call to the real `code.js` running on the same in-memory fake spreadsheet, so a click on a button exercises the actual UI and the actual backend together, with no Google account. Only functions without a trailing `_` are callable from the page, exactly like Apps Script.

```
npm install                       # once (installs Playwright)
npx playwright install chromium   # once (downloads the browser, ~150 MB)
npm run test:ui                   # about a minute
npm run test:all                  # Node tests, then UI tests
```

| File | Covers |
| --- | --- |
| `ui-tests/login.spec.js` | Wrong / right password, reload keeps the session, logout, expired session |
| `ui-tests/roles.spec.js` | Read-only role: no edit / delete / close controls, and the server refuses it anyway; console cannot reach server functions |
| `ui-tests/customers.spec.js` | Customers and bank accounts: add, validate, edit, delete with confirmation, search, detail view |
| `ui-tests/ornaments-loans.spec.js` | Ornament form calculations and live gold rates; creating, editing and over-limit loans; overdue flag; loan detail |
| `ui-tests/closure-admin.spec.js` | Close and release a loan; admin login accounts |
| `ui-tests/smoke.spec.js` | Every screen and detail view opens with no JavaScript errors; dashboard totals; sorting |
| `ui-tests/known-bugs.spec.js` | Known UI bugs (unescaped HTML / XSS, apostrophe in a name, zoom locked) as `test.fail()` |

- The first run needs internet: Tailwind and other scripts are fetched once and cached in `.cache/` (git-ignored), then the tests also run offline.
- **A `test.fail()` that starts failing the other way** (Playwright reports "expected to fail but passed") means the bug was fixed: change `test.fail(` to `test(`.
- On a failure Playwright saves a screenshot and a trace in `test-results/` (git-ignored); open a trace with `npx playwright show-trace <path>`.
- These tests use a fake, so they cannot see things only real Google shows (Sheets date storage, Drive permissions, slow Apps Script calls, the real iframe on your domain).
