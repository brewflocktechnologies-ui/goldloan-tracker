'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/backend');

const img = (name = 'o.jpg', body = 'img') => ({ name, mimeType: 'image/jpeg', base64: Buffer.from(body).toString('base64') });
const urlOf = f => `https://drive.google.com/file/d/${f.id}/view?usp=drivesdk`;

describe('ornaments: create and derived values', () => {
  test('applies the form defaults (22K, quantity 1, Available)', () => {
    const app = loadBackend();
    const res = app.api(app.superToken()).addOrnament({ OrnamentName: 'Ring', GrossWeight: 5 });
    assert.equal(res.success, true);
    assert.equal(res.data.OrnamentId, 'ORN001');
    const row = app.table('Ornaments')[0];
    assert.equal(row.Purity, '22K');
    assert.equal(row.Quantity, 1);
    assert.equal(row.Status, 'Available');
  });

  test('metal and net weight are gross minus stone', () => {
    const app = loadBackend();
    app.api(app.superToken()).addOrnament({ OrnamentName: 'Necklace', GrossWeight: 10, StoneWeight: 1.5 });
    const row = app.table('Ornaments')[0];
    assert.equal(row.GrossWeight, 10);
    assert.equal(row.StoneWeight, 1.5);
    assert.equal(row.MetalWeight, 8.5);
    assert.equal(row.NetWeight, 8.5);
  });

  test('an explicit metal weight wins and net mirrors it', () => {
    const app = loadBackend();
    app.api(app.superToken()).addOrnament({ OrnamentName: 'Coin', GrossWeight: 10, StoneWeight: 1, MetalWeight: 9.2 });
    const row = app.table('Ornaments')[0];
    assert.equal(row.MetalWeight, 9.2);
    assert.equal(row.NetWeight, 9.2);
  });

  test('buying cost, market value and appreciation come from metal weight x rate', () => {
    const app = loadBackend();
    app.api(app.superToken()).addOrnament({
      OrnamentName: 'Chain', GrossWeight: 10, StoneWeight: 1.5, BuyingPricePerGram: 6000, CurrentPricePerGram: 7000,
    });
    const row = app.table('Ornaments')[0];
    assert.equal(row.BuyingCost, 51000); // 8.5 g x 6000
    assert.equal(row.TotalPrice, 51000);
    assert.equal(row.MarketValue, 59500); // 8.5 g x 7000
    assert.equal(row.AppreciationValue, 8500);
    assert.equal(row.AppreciationPercentage, 16.67);
    assert.equal(row.EstimatedValue, 59500);
  });

  test('an explicit buying cost is kept instead of being recalculated', () => {
    const app = loadBackend();
    app.api(app.superToken()).addOrnament({ OrnamentName: 'Chain', GrossWeight: 10, BuyingPricePerGram: 6000, BuyingCost: 50000 });
    assert.equal(app.table('Ornaments')[0].BuyingCost, 50000);
  });

  test('an ornament can be created with no owner', () => {
    const app = loadBackend();
    const res = app.api(app.superToken()).addOrnament({ OrnamentName: 'Spare', GrossWeight: 3 });
    assert.equal(res.success, true);
    assert.equal(app.table('Ornaments')[0].UserId, '');
  });

  test('uploaded images go to Ornament_Images and are stored pipe-separated', () => {
    const app = loadBackend();
    app.api(app.superToken()).addOrnament({ OrnamentName: 'Chain', GrossWeight: 10, files: [img('a.jpg'), img('b.jpg')] });
    const files = [...app.fake.drive.files.values()];
    assert.equal(files.length, 2);
    assert.ok(files.every(f => f.folder === 'Ornament_Images'));
    assert.equal(app.table('Ornaments')[0].OrnamentImages, files.map(urlOf).join(' | '));
  });
});

describe('ornaments: read', () => {
  test('getOrnaments hides deleted ones and can filter by owner', () => {
    const app = loadBackend();
    const u1 = app.seed.user({ FullName: 'One' });
    const u2 = app.seed.user({ FullName: 'Two' });
    app.seed.ornament({ UserId: u1.UserId, OrnamentName: 'A' });
    app.seed.ornament({ UserId: u2.UserId, OrnamentName: 'B' });
    const gone = app.seed.ornament({ UserId: u1.UserId, OrnamentName: 'C' });
    const api = app.api(app.superToken());
    api.deleteOrnament(gone.OrnamentId);
    assert.deepEqual(api.getOrnaments().data.map(o => o.OrnamentName), ['A', 'B']);
    assert.deepEqual(api.getOrnaments(u1.UserId).data.map(o => o.OrnamentName), ['A']);
  });

  test('getAvailableOrnaments lists Available and Released, but not Pledged', () => {
    const app = loadBackend();
    const { user, bank, orn1, orn2 } = app.scenario();
    const api = app.api(app.superToken());
    const loan = app.seed.loan({ UserId: user.UserId, BankAccountId: bank.BankAccountId, ornamentIds: [orn1.OrnamentId] });
    assert.deepEqual(api.getAvailableOrnaments().data.map(o => o.OrnamentId), [orn2.OrnamentId]);
    api.closeAndReleaseLoan(loan.LoanId, 'done');
    const ids = api.getAvailableOrnaments().data.map(o => o.OrnamentId).sort();
    assert.deepEqual(ids, [orn1.OrnamentId, orn2.OrnamentId].sort());
  });
});

describe('ornaments: update and delete', () => {
  test('changing metal weight keeps net weight in sync, and numeric strings become numbers', () => {
    const app = loadBackend();
    const orn = app.seed.ornament({ GrossWeight: 10 });
    const res = app.api(app.superToken()).updateOrnament(orn.OrnamentId, { GrossWeight: '12.5', StoneWeight: '0.5', MetalWeight: '12', BuyingPricePerGram: '6100' });
    assert.equal(res.success, true);
    const row = app.table('Ornaments')[0];
    assert.equal(row.GrossWeight, 12.5);
    assert.equal(row.StoneWeight, 0.5);
    assert.equal(row.MetalWeight, 12);
    assert.equal(row.NetWeight, 12);
    assert.equal(row.BuyingPricePerGram, 6100);
  });

  test('BuyingCost and TotalPrice stay equal when either is updated', () => {
    const app = loadBackend();
    const orn = app.seed.ornament();
    const api = app.api(app.superToken());
    api.updateOrnament(orn.OrnamentId, { BuyingCost: '40000' });
    assert.equal(app.table('Ornaments')[0].TotalPrice, 40000);
    api.updateOrnament(orn.OrnamentId, { TotalPrice: '45000' });
    assert.equal(app.table('Ornaments')[0].BuyingCost, 45000);
  });

  test('new images are appended to the existing ones', () => {
    const app = loadBackend();
    const orn = app.seed.ornament({ files: [img('a.jpg')] });
    app.api(app.superToken()).updateOrnament(orn.OrnamentId, { files: [img('b.jpg')] });
    const files = [...app.fake.drive.files.values()];
    assert.equal(files.length, 2);
    assert.equal(app.table('Ornaments')[0].OrnamentImages, files.map(urlOf).join(' | '));
  });

  test('updating other fields leaves the images alone', () => {
    const app = loadBackend();
    const orn = app.seed.ornament({ files: [img('a.jpg')] });
    const before = app.table('Ornaments')[0].OrnamentImages;
    app.api(app.superToken()).updateOrnament(orn.OrnamentId, { Remarks: 'checked' });
    assert.equal(app.table('Ornaments')[0].OrnamentImages, before);
  });

  test('deleteOrnamentImage removes just that link and trashes just that file', () => {
    const app = loadBackend();
    const orn = app.seed.ornament({ files: [img('a.jpg'), img('b.jpg')] });
    const [a, b] = [...app.fake.drive.files.values()];
    const res = app.api(app.superToken()).deleteOrnamentImage(orn.OrnamentId, urlOf(a));
    assert.equal(res.success, true);
    assert.equal(app.table('Ornaments')[0].OrnamentImages, urlOf(b));
    assert.equal(a.trashed, true);
    assert.equal(b.trashed, false);
  });

  test('deleteOrnament is a soft delete', () => {
    const app = loadBackend();
    const orn = app.seed.ornament();
    assert.equal(app.api(app.superToken()).deleteOrnament(orn.OrnamentId).success, true);
    assert.equal(app.table('Ornaments')[0].Status, 'Deleted');
  });

  test('deleting an unknown ornament reports not found', () => {
    const app = loadBackend();
    const res = app.api(app.superToken()).deleteOrnament('ORN999');
    assert.equal(res.success, false);
    assert.match(res.error, /not found/);
  });

  test('a read-only User cannot add, edit, delete or remove images', () => {
    const app = loadBackend();
    const orn = app.seed.ornament();
    const viewer = app.api(app.viewerToken());
    assert.equal(viewer.getOrnaments().success, true);
    for (const [action, args] of [['addOrnament', [{ OrnamentName: 'X' }]], ['updateOrnament', [orn.OrnamentId, { Remarks: 'x' }]], ['deleteOrnament', [orn.OrnamentId]], ['deleteOrnamentImage', [orn.OrnamentId, 'u']]]) {
      assert.equal(viewer[action](...args).code, 403, action);
    }
    assert.equal(app.table('Ornaments')[0].Status, 'Available');
  });
});
