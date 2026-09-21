'use strict';
/**
 * In-memory fake of the Google Apps Script services that code.js uses:
 * SpreadsheetApp, PropertiesService, CacheService, Utilities, DriveApp,
 * UrlFetchApp, Session, ContentService, HtmlService.
 *
 * It only implements the surface code.js touches. It is deliberately strict
 * where real Google is strict (e.g. DriveApp.getFileById throws for unknown ids,
 * getDataRange() pads rows to a rectangle) so tests don't pass on behaviour the
 * real service wouldn't have.
 *
 * Options:
 *   autoParseDates    Mimic Sheets turning "YYYY-MM-DD" strings into Date cells.
 *   sheetTzOffsetMin  Spreadsheet timezone offset used for those dates (default IST, 330).
 */
const crypto = require('node:crypto');

function makeFake(options = {}) {
  const state = {
    sheets: new Map(), // name -> array of row arrays
    props: new Map(),
    cache: new Map(),
    files: new Map(), // fileId -> { id, name, mime, bytes, trashed, sharing }
    folders: [], // { name, parent, api }
    fetchImpl: () => { throw new Error('UrlFetchApp.fetch was called but not stubbed in this test'); },
    fetchCalls: [],
    activeEmail: '',
    ownerEmail: 'owner@example.com',
    logs: [],
    autoParseDates: !!options.autoParseDates,
    sheetTzOffsetMin: options.sheetTzOffsetMin === undefined ? 330 : options.sheetTzOffsetMin,
    idSeq: 0,
  };

  // ── Sheets ──
  const coerce = v => {
    if (state.autoParseDates && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split('-').map(Number);
      // Sheets stores a date as midnight in the spreadsheet's timezone.
      return new Date(Date.UTC(y, m - 1, d) - state.sheetTzOffsetMin * 60000);
    }
    return v;
  };

  function makeSheet(name) {
    const rows = state.sheets.get(name);
    const width = () => rows.reduce((m, r) => Math.max(m, r.length), 0);
    const ensure = (r, c) => {
      while (rows.length < r) rows.push([]);
      while (rows[r - 1].length < c) rows[r - 1].push('');
    };
    const makeRange = (r, c, nr = 1, nc = 1) => {
      const range = {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) {
              const v = (rows[r - 1 + i] || [])[c - 1 + j];
              row.push(v === undefined ? '' : v);
            }
            out.push(row);
          }
          return out;
        },
        setValues(vals) {
          vals.forEach((row, i) => row.forEach((v, j) => {
            ensure(r + i, c + j);
            rows[r - 1 + i][c - 1 + j] = coerce(v);
          }));
          return range;
        },
        setValue(v) {
          ensure(r, c);
          rows[r - 1][c - 1] = coerce(v);
          return range;
        },
        setFontWeight() { return range; },
        setBackground() { return range; },
        setFontColor() { return range; },
      };
      return range;
    };
    const sheet = {
      getName: () => name,
      getDataRange: () => makeRange(1, 1, Math.max(1, rows.length), Math.max(1, width())),
      getRange: (r, c, nr, nc) => makeRange(r, c, nr, nc),
      getLastRow: () => rows.length,
      getLastColumn: () => width(),
      setFrozenRows() {},
      appendRow(arr) { rows.push(arr.map(coerce)); return sheet; },
      deleteRow(n) { rows.splice(n - 1, 1); return sheet; },
    };
    return sheet;
  }

  const spreadsheet = {
    getId: () => 'FAKE_SPREADSHEET_ID',
    getSheetByName: n => (state.sheets.has(n) ? makeSheet(n) : null),
    insertSheet(n) {
      if (state.sheets.has(n)) throw new Error(`A sheet with the name "${n}" already exists.`);
      state.sheets.set(n, []);
      return makeSheet(n);
    },
  };

  // ── Drive ──
  const iter = arr => {
    let i = 0;
    return { hasNext: () => i < arr.length, next: () => arr[i++] };
  };
  const fileApi = f => ({
    getId: () => f.id,
    getName: () => f.name,
    getUrl: () => `https://drive.google.com/file/d/${f.id}/view?usp=drivesdk`,
    setSharing(access, permission) {
      if (options.failSharing) throw new Error('Sharing is restricted by domain policy');
      f.sharing = { access, permission };
      return fileApi(f);
    },
    setTrashed(t) { f.trashed = !!t; return fileApi(f); },
  });
  function makeFolder(name, parent) {
    const folder = { name, parent, api: null };
    folder.api = {
      getName: () => name,
      getFoldersByName: n => iter(state.folders.filter(f => f.parent === folder && f.name === n).map(f => f.api)),
      createFolder(n) { const child = makeFolder(n, folder); state.folders.push(child); return child.api; },
      createFile(blob) {
        const f = {
          id: 'FILE' + String(++state.idSeq).padStart(4, '0'),
          name: blob.name, mime: blob.mime, bytes: blob.bytes, trashed: false, sharing: null, folder: name,
        };
        state.files.set(f.id, f);
        return fileApi(f);
      },
    };
    return folder;
  }
  const DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK', PRIVATE: 'PRIVATE' },
    Permission: { VIEW: 'VIEW', EDIT: 'EDIT' },
    getFoldersByName: n => iter(state.folders.filter(f => !f.parent && f.name === n).map(f => f.api)),
    createFolder(n) { const f = makeFolder(n, null); state.folders.push(f); return f.api; },
    getFileById(id) {
      const f = state.files.get(id);
      if (!f) throw new Error('No item with the given ID could be found, or you do not have permission to access it.');
      return fileApi(f);
    },
  };

  // ── Utilities ──
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(_alg, value) {
      // Apps Script returns signed bytes
      return Array.from(crypto.createHash('sha256').update(String(value), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b));
    },
    getUuid: () => crypto.randomUUID(),
    base64Decode: s => Array.from(Buffer.from(String(s), 'base64')).map(b => (b > 127 ? b - 256 : b)),
    newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    formatDate(date, tz, format) {
      if (format === 'dd MMMM yyyy') {
        return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: tz });
      }
      return new Date(date).toISOString();
    },
  };

  // ── Everything else ──
  const globals = {
    console: {
      log: (...a) => state.logs.push(['log', ...a]),
      warn: (...a) => state.logs.push(['warn', ...a]),
      error: (...a) => state.logs.push(['error', ...a]),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (state.props.has(k) ? state.props.get(k) : null),
        setProperty(k, v) { state.props.set(k, String(v)); },
        deleteProperty(k) { state.props.delete(k); },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (state.cache.has(k) ? state.cache.get(k) : null),
        put(k, v) { state.cache.set(k, String(v)); },
        remove(k) { state.cache.delete(k); },
      }),
    },
    Utilities,
    DriveApp,
    UrlFetchApp: {
      fetch(url, opts) {
        state.fetchCalls.push({ url, opts });
        return state.fetchImpl(url, opts);
      },
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => state.activeEmail }),
      getEffectiveUser: () => ({ getEmail: () => state.ownerEmail }),
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: text => {
        const out = { getContent: () => text, mime: null, setMimeType(m) { out.mime = m; return out; } };
        return out;
      },
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: file => {
        const out = {
          file, title: null, meta: {},
          setTitle(t) { out.title = t; return out; },
          addMetaTag(k, v) { out.meta[k] = v; return out; },
          setXFrameOptionsMode() { return out; },
        };
        return out;
      },
    },
  };

  return {
    globals,
    state,
    logs: state.logs,
    props: state.props,
    cache: state.cache,
    drive: { files: state.files, folders: state.folders },
    ownerEmail: state.ownerEmail,
    setActiveEmail(email) { state.activeEmail = email; },
    setFetch(fn) { state.fetchImpl = fn; },
    fetchCalls: state.fetchCalls,
    /** Raw rows of a sheet (row 0 is the header row). */
    rows(name) { return state.sheets.get(name) || []; },
    /** Sheet rows as objects keyed by header. */
    table(name) {
      const rows = state.sheets.get(name) || [];
      if (rows.length === 0) return [];
      const headers = rows[0];
      return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
    },
  };
}

module.exports = { makeFake };
