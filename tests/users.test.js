'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend');

const photo = (name = 'photo.png', body = 'hello') => ({ name, mimeType: 'image/png', base64: Buffer.from(body).toString('base64') });
const driveFiles = app => [...app.fake.drive.files.values()];

describe('users (customers): create', () => {
  test('assigns sequential ids, Active status and a created date', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    const a = api.addUser({ FullName: 'Asha Rao', MobileNumber: '9990001111' });
    const b = api.addUser({ FullName: 'Bala K' });
    assert.equal(a.success, true);
    assert.equal(a.data.UserId, 'U001');
    assert.equal(b.data.UserId, 'U002');
    const row = app.table('Users')[0];
    assert.equal(row.Status, 'Active');
    assert.equal(row.FullName, 'Asha Rao');
    assert.equal(row.MobileNumber, '9990001111');
    assert.ok(!isNaN(Date.parse(row.CreatedDate)));
  });

  test('stores every KYC field the form sends', () => {
    const app = loadBackend();
    const input = {
      FullName: 'Asha Rao', FatherHusbandName: 'Ravi Rao', MobileNumber: '9990001111', AlternateMobileNumber: '9990002222',
      Email: 'asha@example.com', DateOfBirth: '1990-05-17', Gender: 'Female', AadhaarNumber: '123412341234', PANNumber: 'ABCDE1234F',
      AddressLine1: '12 MG Road', AddressLine2: 'Indiranagar', City: 'Bengaluru', State: 'Karnataka', Pincode: '560038', Occupation: 'Teacher',
      CustomerCode: 'C-77',
    };
    const res = app.api(app.superToken()).addUser(input);
    assert.equal(res.success, true);
    const row = app.table('Users')[0];
    for (const [k, v] of Object.entries(input)) assert.equal(row[k], v, k);
  });

  test('uploads the photo to the Customer_Photos Drive folder and saves its link', () => {
    const app = loadBackend();
    const res = app.api(app.superToken()).addUser({ FullName: 'Asha', files: [photo('me.png', 'PNGDATA')] });
    assert.equal(res.success, true);
    const files = driveFiles(app);
    assert.equal(files.length, 1);
    assert.equal(files[0].folder, 'Customer_Photos');
    assert.equal(Buffer.from(files[0].bytes.map(b => b & 0xff)).toString(), 'PNGDATA');
    assert.equal(app.table('Users')[0].CustomerPhoto, `https://drive.google.com/file/d/${files[0].id}/view?usp=drivesdk`);
  });

  test('still saves the customer when Drive refuses to set link sharing', () => {
    const app = loadBackend({ failSharing: true });
    const res = app.api(app.superToken()).addUser({ FullName: 'Asha', files: [photo()] });
    assert.equal(res.success, true);
    assert.ok(app.table('Users')[0].CustomerPhoto);
  });
});

describe('users (customers): read, update, delete', () => {
  test('getUsers returns active customers and hides deleted ones', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    api.addUser({ FullName: 'Keep' });
    api.addUser({ FullName: 'Remove' });
    api.deleteUser('U002');
    const names = api.getUsers().data.map(u => u.FullName);
    assert.deepEqual(names, ['Keep']);
  });

  test('updateUser changes only the fields sent and stamps UpdatedDate', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    api.addUser({ FullName: 'Asha', MobileNumber: '111', City: 'Mysuru' });
    const res = api.updateUser('U001', { FullName: 'Asha Rao', MobileNumber: '222' });
    assert.equal(res.success, true);
    const row = app.table('Users')[0];
    assert.equal(row.FullName, 'Asha Rao');
    assert.equal(row.MobileNumber, '222');
    assert.equal(row.City, 'Mysuru');
    assert.ok(!isNaN(Date.parse(row.UpdatedDate)));
  });

  test('updateUser only touches the targeted customer', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    api.addUser({ FullName: 'One' });
    api.addUser({ FullName: 'Two' });
    api.updateUser('U002', { FullName: 'Two Updated' });
    assert.deepEqual(app.table('Users').map(u => u.FullName), ['One', 'Two Updated']);
  });

  test('a new photo on update replaces the stored link', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    api.addUser({ FullName: 'Asha', files: [photo('a.png')] });
    const first = app.table('Users')[0].CustomerPhoto;
    api.updateUser('U001', { files: [photo('b.png')] });
    const second = app.table('Users')[0].CustomerPhoto;
    assert.notEqual(first, second);
    assert.equal(driveFiles(app).length, 2);
  });

  test('updateUser with deleteCustomerPhoto clears the link and trashes the Drive file', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    api.addUser({ FullName: 'Asha', files: [photo()] });
    const [file] = driveFiles(app);
    assert.equal(api.updateUser('U001', { deleteCustomerPhoto: true }).success, true);
    assert.equal(app.table('Users')[0].CustomerPhoto, '');
    assert.equal(file.trashed, true);
  });

  test('deleteUserPhoto clears the link, stamps UpdatedDate and trashes the file', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    api.addUser({ FullName: 'Asha', files: [photo()] });
    const [file] = driveFiles(app);
    assert.equal(api.deleteUserPhoto('U001').success, true);
    const row = app.table('Users')[0];
    assert.equal(row.CustomerPhoto, '');
    assert.ok(row.UpdatedDate);
    assert.equal(file.trashed, true);
    assert.equal(row.FullName, 'Asha');
  });

  test('deleteUser is a soft delete: the row stays with Status Deleted', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    api.addUser({ FullName: 'Asha' });
    assert.equal(api.deleteUser('U001').success, true);
    const rows = app.table('Users');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Status, 'Deleted');
  });

  test('ids keep counting after a soft delete (no reuse)', () => {
    const app = loadBackend();
    const api = app.api(app.superToken());
    api.addUser({ FullName: 'One' });
    api.deleteUser('U001');
    assert.equal(api.addUser({ FullName: 'Two' }).data.UserId, 'U002');
  });

  test('a read-only User cannot add, update, delete or remove a photo', () => {
    const app = loadBackend();
    app.seed.user();
    const viewer = app.api(app.viewerToken());
    for (const [action, args] of [['addUser', [{ FullName: 'X' }]], ['updateUser', ['U001', { FullName: 'X' }]], ['deleteUser', ['U001']], ['deleteUserPhoto', ['U001']]]) {
      assert.equal(viewer[action](...args).code, 403, action);
    }
    assert.equal(app.table('Users')[0].FullName, 'Asha Rao');
    assert.equal(app.table('Users')[0].Status, 'Active');
  });
});
