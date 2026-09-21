'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend');

describe('login', () => {
  test('correct credentials return a 64-char session token and the role', () => {
    const app = loadBackend();
    const res = app.login('admin', 'password123');
    assert.equal(res.success, true);
    assert.equal(res.data.role, 'SuperAdmin');
    assert.match(res.data.token, /^[0-9a-f]{64}$/);
  });

  test('wrong password and unknown user are rejected with the same message', () => {
    const app = loadBackend();
    const wrongPw = app.login('admin', 'nope');
    const noUser = app.login('ghost', 'password123');
    assert.equal(wrongPw.success, false);
    assert.equal(noUser.success, false);
    assert.equal(wrongPw.error, noUser.error);
  });

  test('passwords are stored hashed, never as plain text', () => {
    const app = loadBackend();
    const stored = app.table('Admins')[0].Password;
    assert.notEqual(stored, 'password123');
    assert.match(stored, /^[0-9a-f]{64}$/);
  });

  test('an Inactive account cannot log in', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    api.addAdminUser({ username: 'staff', password: 'pw1234', role: 'User' }, app.superToken());
    const staff = app.table('Admins').find(a => a.Username === 'staff');
    api.updateAdminUser(staff.AdminId, { status: 'Inactive' }, '', app.superToken());
    assert.equal(app.login('staff', 'pw1234').success, false);
  });

  test('locks out after 5 failed attempts, even for the right password, until the window passes', () => {
    const app = loadBackend();
    for (let i = 0; i < 5; i++) {
      assert.equal(app.login('admin', 'wrong').error, 'Invalid username or password.');
    }
    const sixth = app.login('admin', 'password123');
    assert.equal(sixth.success, false);
    assert.match(sixth.error, /Too many failed login attempts/);
  });

  test('a successful login resets the failed-attempt counter', () => {
    const app = loadBackend();
    for (let i = 0; i < 4; i++) app.login('admin', 'wrong');
    assert.equal(app.login('admin', 'password123').success, true);
    for (let i = 0; i < 4; i++) app.login('admin', 'wrong');
    assert.equal(app.login('admin', 'password123').success, true);
  });
});

describe('sessions and rpc guard', () => {
  test('no token, forged token and a bare role string are all rejected with 401', () => {
    const app = loadBackend();
    for (const bad of ['', undefined, 'SuperAdmin', 'admin', 'a'.repeat(64)]) {
      const res = app.rpc(bad, 'getUsers', []);
      assert.equal(res.success, false, `token ${JSON.stringify(bad)}`);
      assert.equal(res.code, 401, `token ${JSON.stringify(bad)}`);
    }
  });

  test('an expired session is rejected and removed', () => {
    const app = loadBackend();
    const token = app.superToken();
    const key = 'SESSION_' + token;
    const session = JSON.parse(app.fake.props.get(key));
    app.fake.props.set(key, JSON.stringify({ ...session, expiry: Date.now() - 1000 }));
    assert.equal(app.rpc(token, 'getUsers', []).code, 401);
    assert.equal(app.fake.props.has(key), false);
  });

  test('logout invalidates the token on the server', () => {
    const app = loadBackend();
    const token = app.login('admin', 'password123').data.token;
    assert.equal(app.rpc(token, 'getUsers', []).success, true);
    assert.equal(app.ctx.logoutAdmin(token).success, true);
    assert.equal(app.rpc(token, 'getUsers', []).code, 401);
  });

  test('private helpers and object-prototype names are not reachable through rpc', () => {
    const app = loadBackend();
    const token = app.superToken();
    for (const name of ['getSheetData_', 'updateRow_', 'appendRow_', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const res = app.rpc(token, name, ['Users']);
      assert.equal(res.success, false, name);
      assert.match(res.error, /Unknown action/, name);
    }
  });

  test('a read-only User can read but every write is refused with 403 and changes nothing', () => {
    const app = loadBackend();
    const viewer = app.api(app.viewerToken());
    assert.equal(viewer.getUsers().success, true);
    const res = viewer.addUser({ FullName: 'Sneaky' });
    assert.equal(res.code, 403);
    assert.equal(app.table('Users').length, 0);
  });
});

describe('privilege escalation attempts that used to work', () => {
  test('passing the literal string "SuperAdmin" as the caller creates nothing', () => {
    const app = loadBackend();
    const res = app.ctx.addAdminUser_({ username: 'evil', password: 'x', role: 'SuperAdmin' }, 'SuperAdmin');
    assert.equal(res.success, false);
    assert.equal(app.table('Admins').some(a => a.Username === 'evil'), false);
  });

  test('resetting the admin password by claiming to be "admin" is refused', () => {
    const app = loadBackend();
    const before = app.table('Admins')[0].Password;
    const res = app.ctx.updateAdminUser_('ADM001', { password: 'hacked' }, 'admin', '');
    assert.equal(res.success, false);
    assert.equal(app.table('Admins')[0].Password, before);
  });

  test('changePassword with only a username (no session) is refused', () => {
    const app = loadBackend();
    const res = app.ctx.changePassword_('newpass', 'password123', 'admin');
    assert.equal(res.success, false);
    assert.equal(app.login('admin', 'password123').success, true);
  });

  test('a User-role token cannot create a SuperAdmin', () => {
    const app = loadBackend();
    const viewerToken = app.viewerToken();
    const res = app.api(viewerToken).addAdminUser({ username: 'evil', password: 'x', role: 'SuperAdmin' }, viewerToken);
    assert.equal(res.code, 403);
  });
});

describe('admin account management', () => {
  test('SuperAdmin can add, and duplicate usernames (any case) are refused', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    assert.equal(api.addAdminUser({ username: 'Staff1', password: 'pw1234', role: 'User' }, app.superToken()).success, true);
    const dup = api.addAdminUser({ username: 'staff1', password: 'pw1234' }, app.superToken());
    assert.equal(dup.success, false);
    assert.match(dup.error, /already exists/);
  });

  test('role defaults to the read-only User unless SuperAdmin is explicitly requested', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    api.addAdminUser({ username: 'a', password: 'pw1234' }, app.superToken());
    api.addAdminUser({ username: 'b', password: 'pw1234', role: 'bogus' }, app.superToken());
    const admins = app.table('Admins');
    assert.equal(admins.find(x => x.Username === 'a').Role, 'User');
    assert.equal(admins.find(x => x.Username === 'b').Role, 'User');
  });

  test('a SuperAdmin cannot delete, demote or deactivate themselves', () => {
    const app = loadBackend();
    const token = app.superToken();
    const api = app.api(token);
    assert.match(api.deleteAdminLoginUser('ADM001', '', token).error, /cannot delete your own/);
    assert.match(api.updateAdminUser('ADM001', { role: 'User' }, '', token).error, /cannot change your own role/);
    assert.match(api.updateAdminUser('ADM001', { status: 'Inactive' }, '', token).error, /cannot deactivate your own/);
  });

  test('a User can change only their own password, not role or status', () => {
    const app = loadBackend();
    const token = app.viewerToken();
    const api = app.api(token);
    const me = app.table('Admins').find(a => a.Username === 'viewer');
    const escalate = api.updateAdminUser(me.AdminId, { role: 'SuperAdmin' }, '', token);
    assert.equal(escalate.success, false);
    assert.equal(api.updateAdminUser(me.AdminId, { password: 'brand-new' }, '', token).success, true);
    assert.equal(app.login('viewer', 'brand-new').success, true);
  });

  test('a User cannot touch someone else\'s account', () => {
    const app = loadBackend();
    const token = app.viewerToken();
    const res = app.api(token).updateAdminUser('ADM001', { password: 'x1234' }, '', token);
    assert.equal(res.success, false);
    assert.equal(app.login('admin', 'password123').success, true);
  });

  test('changePassword needs the current password, then the new one works', () => {
    const app = loadBackend();
    const token = app.superToken();
    const api = app.api(token);
    assert.match(api.changePassword('newpass1', undefined, token).error, /Current password is required/);
    assert.match(api.changePassword('newpass1', 'wrong', token).error, /does not match/);
    assert.match(api.changePassword('ab', 'password123', token).error, /at least 4/);
    assert.equal(api.changePassword('newpass1', 'password123', token).success, true);
    assert.equal(app.login('admin', 'newpass1').success, true);
    assert.equal(app.login('admin', 'password123').success, false);
  });

  test('deleted admins disappear from the list and cannot log in', () => {
    const app = loadBackend();
    const token = app.superToken();
    const api = app.api(token);
    api.addAdminUser({ username: 'temp', password: 'pw1234' }, token);
    const temp = app.table('Admins').find(a => a.Username === 'temp');
    assert.equal(api.deleteAdminLoginUser(temp.AdminId, '', token).success, true);
    assert.equal(api.getAdminUsers(token).data.some(a => a.Username === 'temp'), false);
    assert.equal(app.login('temp', 'pw1234').success, false);
  });

  test('the admin list never includes password hashes', () => {
    const app = loadBackend();
    const token = app.superToken();
    const list = app.api(token).getAdminUsers(token).data;
    assert.ok(list.length > 0);
    for (const a of list) assert.equal('Password' in a, false);
  });
});

describe('functions meant only for the script owner', () => {
  test('setupSheets, migrateAdminPasswordsToHashed and testGoldRates refuse a web visitor', () => {
    const app = loadBackend();
    const results = {
      setupSheets: app.ctx.setupSheets(),
    };
    assert.equal(results.setupSheets.success, false);
    assert.match(results.setupSheets.error, /script owner/);
    assert.throws(() => app.ctx.migrateAdminPasswordsToHashed(), /script owner/);
    assert.throws(() => app.ctx.testGoldRates(), /script owner/);
  });

  test('setupSheets is idempotent for the owner: re-running does not duplicate the admin', () => {
    const app = loadBackend();
    app.bootstrap();
    app.bootstrap();
    assert.equal(app.table('Admins').length, 1);
  });

  test('migrateAdminPasswordsToHashed hashes plain-text passwords and skips already-hashed ones', () => {
    const app = loadBackend();
    app.rows('Admins').push(['ADM009', 'legacy', 'plain-secret', 'User', 'Active']);
    const hashedBefore = app.table('Admins')[0].Password;
    app.fake.setActiveEmail(app.fake.ownerEmail);
    app.ctx.migrateAdminPasswordsToHashed();
    const admins = app.table('Admins');
    assert.equal(admins[0].Password, hashedBefore);
    assert.match(admins[1].Password, /^[0-9a-f]{64}$/);
    assert.equal(app.login('legacy', 'plain-secret').success, true);
  });
});

describe('REST endpoint (used by the mobile app)', () => {
  test('login returns a token that authorises later calls', () => {
    const app = loadBackend();
    const login = app.rest.post({ action: 'login', username: 'admin', password: 'password123' });
    assert.equal(login.success, true);
    const res = app.rest.get({ action: 'getUsers', token: login.data.token });
    assert.equal(res.success, true);
  });

  test('missing or bad token gets 401; ping and login stay public', () => {
    const app = loadBackend();
    assert.equal(app.rest.get({ action: 'getUsers' }).code, 401);
    assert.equal(app.rest.post({ action: 'getUsers', token: 'nope' }).code, 401);
    assert.equal(app.rest.get({ action: 'ping' }).data, 'PONG');
  });

  test('a User token gets 403 on writes, and the write does not happen', () => {
    const app = loadBackend();
    app.seed.user();
    const token = app.viewerToken();
    const res = app.rest.post({ action: 'deleteUser', token, userId: 'U001' });
    assert.equal(res.code, 403);
    assert.equal(app.table('Users')[0].Status, 'Active');
  });

  test('unknown actions and a missing action are reported, not thrown', () => {
    const app = loadBackend();
    const token = app.superToken();
    assert.match(app.rest.post({ action: 'doEvil', token }).error, /Unknown action/);
    assert.match(app.rest.post({}).error, /No action specified/);
  });

  test('opening the web app URL without an action serves the HTML page', () => {
    const app = loadBackend();
    const out = app.ctx.doGet({ parameter: {} });
    assert.equal(out.file, 'index');
    assert.equal(out.title, 'Gold Loan Tracker');
  });
});
