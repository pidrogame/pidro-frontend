import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  globalSetup: ['./support/classic-stand-in.ts', './support/identity-stand-in.ts'],
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'report', open: 'never' }],
    ['json', { outputFile: 'journeys.json' }],
  ],
  outputDir: 'results',
  use: {
    baseURL: process.env.MOBILE_BASE_URL ?? 'http://localhost:8081',
    video: 'on',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } },
    // The layouts that differ most from the phone run a tagged handful of journeys.
    {
      name: 'landscape',
      grep: /@responsive/,
      use: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 },
    },
    {
      name: 'tablet',
      grep: /@responsive/,
      use: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2 },
    },
  ],
});
