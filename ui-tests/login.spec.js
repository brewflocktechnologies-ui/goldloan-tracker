'use strict';
const { test, expect } = require('./fixtures');

test.describe('login, logout and sessions', () => {
  test('a wrong password shows an error and stays on the login screen', async ({ app }) => {
    const { page } = app;
    await app.open();
    await page.locator('#loginUsername').fill('admin');
    await page.locator('#loginPassword').fill('not-the-password');
    await page.locator('#loginBtn').click();

    await expect(page.locator('#loginError')).toBeVisible();
    await expect(page.locator('#loginError')).toHaveText('Invalid username or password.');
    await expect(page.locator('#view-login')).toBeVisible();
    await expect(page.locator('#main-layout')).toBeHidden();
    expect(await app.sessionToken()).toBeNull();
  });

  test('the correct password opens the dashboard and shows who is signed in', async ({ app }) => {
    const { page } = app;
    await app.open();
    await app.login();

    await expect(page.locator('#header-title')).toHaveText('Dashboard Overview');
    await expect(page.locator('#header-user-badge')).toContainText('admin (SuperAdmin)');
    await expect(page.locator('#nav-admin-users')).toBeVisible();
    expect(await app.sessionToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(app.pageErrors).toEqual([]);
  });

  test('empty fields are stopped before anything is sent', async ({ app }) => {
    const { page } = app;
    await app.open();
    await page.locator('#loginBtn').click();
    await expect(page.locator('#view-login')).toBeVisible();
    expect(app.backend.fake.props.size).toBe(0); // no login attempt, so no rate-limit or session entries
  });

  test('reloading the page keeps you signed in', async ({ app }) => {
    const { page } = app;
    await app.open();
    await app.login();
    await page.reload();

    await expect(page.locator('#main-layout')).toBeVisible();
    await expect(page.locator('#view-login')).toBeHidden();
    await expect(page.locator('#view-dashboard')).toHaveClass(/active/);
  });

  test('logging out returns to the login screen and ends the session on the server', async ({ app }) => {
    const { page } = app;
    await app.open();
    await app.login();
    const token = await app.sessionToken();
    expect(app.backend.fake.props.has('SESSION_' + token)).toBe(true);

    await page.locator('button[onclick="handleLogout()"]').click();

    await expect(page.locator('#view-login')).toBeVisible();
    await expect(page.locator('#main-layout')).toBeHidden();
    expect(await app.sessionToken()).toBeNull();
    await expect.poll(() => app.backend.fake.props.has('SESSION_' + token)).toBe(false);
  });

  test('an expired session sends you back to the login screen instead of failing silently', async ({ app }) => {
    const { page } = app;
    await app.open();
    await app.login();
    const token = await app.sessionToken();

    app.backend.fake.props.delete('SESSION_' + token); // the server forgets the session
    await page.locator('#nav-users').click();

    await expect(page.locator('#view-login')).toBeVisible();
    await expect(page.locator('#main-layout')).toBeHidden();
    await expect(app.toast()).toContainText('Session expired');
  });

  test('a stale token left in the browser cannot be used after a reload', async ({ app }) => {
    const { page } = app;
    await app.open();
    await app.login();
    const token = await app.sessionToken();

    app.backend.fake.props.delete('SESSION_' + token);
    await page.reload();

    await expect(page.locator('#view-login')).toBeVisible();
    await expect(page.locator('#main-layout')).toBeHidden();
  });
});
