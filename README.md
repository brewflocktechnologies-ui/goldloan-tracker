# Gold Loan Tracker

A web-based gold loan management system built on **Google Apps Script + Google Sheets + Google Drive**. It manages customers, bank accounts, ornaments, loans, payments, and loan closure/release of ornaments.

## Live URLs

| What | URL |
| --- | --- |
| Apps Script web app (backend + UI served by Google) | https://script.google.com/macros/s/AKfycbyReA2hwoWcTOlPH9qwHrCD2FW7y8MC2UNX2KXTMD0b7f9uCXSYsMNV8JWvEwO5Bg8/exec |
| Front-end domain (Gold Loan Tracker portal) | https://goldloan.brewflock.com/ |

> The domain `https://goldloan.brewflock.com/` loads the Apps Script web app inside an iframe. The web app is deployed with `XFrameOptionsMode.ALLOWALL`, so it is embeddable on any domain.

## Default Login Credentials

The system seeds one default admin account the **first time** the sheets are initialized (`setupSheets()` is run).

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `password123` | SuperAdmin |

> **IMPORTANT:** Change the default password immediately after first login by editing the **Admins** sheet in the spreadsheet (columns: `AdminId`, `Username`, `Password`, `Role`, `Status`). Password storage is **plain text** — keep the sheet private.

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

- Passwords are stored as plain text in the `Admins` sheet — restrict spreadsheet sharing to authorized people only.
- The web app uses `XFrameOptionsMode.ALLOWALL`, which is what makes embedding on `goldloan.brewflock.com` possible.
- Session is kept only in `sessionStorage` (cleared on logout/browser close).