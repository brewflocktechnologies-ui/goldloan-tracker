'use strict';
/**
 * Loads the real code.js into an isolated vm context wired to the in-memory
 * Google fake, and returns helpers for driving it the way the UI does.
 *
 *   const app = loadBackend();            // fresh empty spreadsheet, sheets initialised
 *   const api = app.api(app.superToken()); // call any UI action: api.addUser({...})
 *   app.table('Users')                     // inspect what actually landed in the sheet
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeFake } = require('./gas-fake');

const ROOT = path.resolve(__dirname, '..', '..');
// Override with GOLDLOAN_CODE_PATH / GOLDLOAN_HTML_PATH to run the suite against another copy
// (e.g. a candidate script before you paste it into Apps Script).
const CODE_PATH = process.env.GOLDLOAN_CODE_PATH || path.join(ROOT, 'code.js');
const HTML_PATH = process.env.GOLDLOAN_HTML_PATH || path.join(ROOT, 'index.html');

// Results cross a vm-realm boundary; a JSON round trip gives plain objects so
// assert.deepStrictEqual (which compares prototypes) behaves.
const plain = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function loadBackend(options = {}) {
  const fake = makeFake(options);
  const ctx = vm.createContext(fake.globals);
  vm.runInContext(fs.readFileSync(CODE_PATH, 'utf8'), ctx, { filename: 'code.js' });

  const app = {
    fake,
    ctx,
    /** Evaluate an expression inside the backend context (for consts like RPC_ACTIONS_). */
    eval: code => plain(vm.runInContext(code, ctx)),

    /** Runs setupSheets() as the script owner (creates the sheets and seeds admin / password123). */
    bootstrap() {
      fake.setActiveEmail(fake.ownerEmail);
      const res = plain(ctx.setupSheets());
      fake.setActiveEmail('');
      if (!res.success) throw new Error('bootstrap failed: ' + res.error);
      return res;
    },

    login(username, password) {
      return plain(ctx.authenticateAdmin(username, password));
    },

    _tokens: {},
    superToken() {
      if (!app._tokens.super) {
        const res = app.login('admin', 'password123');
        if (!res.success) throw new Error('super login failed: ' + res.error);
        app._tokens.super = res.data.token;
      }
      return app._tokens.super;
    },
    /** Creates a read-only "User"-role account (once) and returns a session token for it. */
    viewerToken() {
      if (!app._tokens.viewer) {
        const created = app.api(app.superToken()).addAdminUser({ username: 'viewer', password: 'viewer-pass', role: 'User' }, app.superToken());
        if (!created.success) throw new Error('viewer create failed: ' + created.error);
        const res = app.login('viewer', 'viewer-pass');
        app._tokens.viewer = res.data.token;
      }
      return app._tokens.viewer;
    },

    /** rpc(token, action, args) exactly as google.script.run.rpc would call it. */
    rpc: (token, action, args) => plain(ctx.rpc(token, action, args)),

    /** api(token).getUsers() === rpc(token, 'getUsers', []) */
    api: token => new Proxy({}, {
      get: (_t, action) => (...args) => plain(ctx.rpc(token, String(action), args)),
    }),

    /** REST entry points used by the mobile app. */
    rest: {
      post: body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent()),
      get: params => JSON.parse(ctx.doGet({ parameter: params }).getContent()),
    },

    table: name => fake.table(name),
    rows: name => fake.rows(name),

    readSource: () => fs.readFileSync(CODE_PATH, 'utf8'),
    readHtml: () => fs.readFileSync(HTML_PATH, 'utf8'),
  };

  if (options.bootstrap !== false) app.bootstrap();

  // ── Fixtures: each returns the created record and fails loudly if the backend refuses ──
  let loanSeq = 0;
  const ok = (res, what) => {
    if (!res || !res.success) throw new Error(`fixture ${what} failed: ${res && res.error}`);
    return res.data;
  };
  app.seed = {
    user(o = {}) {
      return ok(app.api(app.superToken()).addUser({ FullName: 'Asha Rao', MobileNumber: '9990001111', City: 'Bengaluru', ...o }), 'user');
    },
    bank(userId, o = {}) {
      return ok(app.api(app.superToken()).addBankAccount({
        UserId: userId, AccountHolderName: 'Asha Rao', AccountNumber: '1234567890', BankName: 'SBI',
        IFSCCode: 'SBIN0000001', MaxLoanAmount: 500000, ...o,
      }), 'bank');
    },
    ornament(o = {}) {
      return ok(app.api(app.superToken()).addOrnament({ OrnamentName: 'Gold Chain', GrossWeight: 10, StoneWeight: 0, Purity: '22K', ...o }), 'ornament');
    },
    /** Payload the loan form sends (all fields present, like the real UI). */
    loanPayload(o = {}) {
      return {
        LoanNumber: 'LN-' + String(++loanSeq).padStart(4, '0'),
        LoanDate: '2026-09-01', DueDate: '2027-03-01', LoanAmount: 100000, InterestRate: 12,
        InterestType: 'Simple', LoanPeriod: 6, ProcessingFee: 500, DocumentCharge: 100, InsuranceCharge: 50,
        TotalCharges: 6500, NetDisbursementAmount: 99350, Remarks: '', ...o,
      };
    },
    loan(o = {}) {
      return ok(app.api(app.superToken()).addLoan(app.seed.loanPayload(o)), 'loan');
    },
    /** A customer with a bank account (limit 500000) and two Available ornaments. */
    scenario() {
      const user = app.seed.user();
      const bank = app.seed.bank(user.UserId);
      const orn1 = app.seed.ornament({ UserId: user.UserId, OrnamentName: 'Chain', GrossWeight: 10 });
      const orn2 = app.seed.ornament({ UserId: user.UserId, OrnamentName: 'Bangle', GrossWeight: 20 });
      return { user, bank, orn1, orn2 };
    },
  };

  app.scenario = () => app.seed.scenario();

  return app;
}

module.exports = { loadBackend, plain, ROOT, CODE_PATH, HTML_PATH };
