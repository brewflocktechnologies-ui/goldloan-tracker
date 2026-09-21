'use strict';
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'ui-tests',
  testMatch: '**/*.spec.js',
  outputDir: 'test-results',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
