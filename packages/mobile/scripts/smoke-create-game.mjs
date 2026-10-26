import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { assertInsideViewport, assertMinimumTouchTargets, UI_VIEWPORTS } from './ui-test-utils.mjs';
import { confirmInitialTable } from './readiness-e2e.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '../../..');

const mobileBaseUrl = process.env.MOBILE_BASE_URL ?? 'http://localhost:8081';
const apiBaseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const username = process.env.SMOKE_USERNAME ?? 'mf2';
const password = process.env.SMOKE_PASSWORD ?? 'hallohallo';
const screenshotDir = resolve(repoRoot, 'screenshots/agent-mobile-live');
const isExpectedResponseFailure = ({ status, url }) =>
  status === 422 ||
  (status === 404 && /\/api\/v1\/rooms\/[A-Z0-9]+\/leave$/.test(new URL(url).pathname));
async function captureCurrentScreen(page, name, testId) {
  const captures = [];
  for (const viewport of UI_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const target = page.getByTestId(testId).first();
    await target.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(250);
    const box = await target.boundingBox();
    if (!box) throw new Error(`${name} has no geometry in ${viewport.name}`);
    assertInsideViewport(name, box, viewport);

    await assertMinimumTouchTargets(page, name, viewport);

    const orientationDir = resolve(screenshotDir, viewport.name);
    await mkdir(orientationDir, { recursive: true });
    await page.screenshot({
      path: resolve(orientationDir, `${name}.png`),
      fullPage: false,
    });
    captures.push(`${viewport.name}/${name}`);
  }
  return captures;
}

async function loginViaApi() {
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error(`API login failed: ${response.status}`);
  }

  const payload = await response.json();
  const token = payload?.data?.token ?? payload?.token;
  if (!token) throw new Error('API login did not return a token');
  return token;
}

async function leaveAnyCurrentRoom(token) {
  await fetch(`${apiBaseUrl}/api/v1/rooms/current/leave`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => {});
}

async function createHiddenCurrentRoom(token) {
  const response = await fetch(`${apiBaseUrl}/api/v1/rooms`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: `Stale ${Date.now().toString().slice(-6)}`,
      seats: { seat_2: 'ai', seat_3: 'ai', seat_4: 'ai' },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Failed to seed hidden current room: ${response.status} ${JSON.stringify(payload)}`
    );
  }
  return payload?.data?.code ?? payload?.code;
}

async function createLiveGameRoom(token) {
  const response = await fetch(`${apiBaseUrl}/api/v1/rooms`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: `Live table ${Date.now().toString().slice(-6)}`,
      seats: { seat_2: 'ai', seat_3: 'ai', seat_4: 'ai' },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Failed to create live game: ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload?.data?.code ?? payload?.code;
}

async function main() {
  await mkdir(screenshotDir, { recursive: true });
  const token = await loginViaApi();
  await leaveAnyCurrentRoom(token);
  const seededRoomCode = await createHiddenCurrentRoom(token);

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const captures = [];

  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !/Failed to load resource:.*status of 422/.test(text)) {
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.message ?? error));
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push({ status: response.status(), url: response.url() });
    }
  });

  try {
    await page.goto(`${mobileBaseUrl}/(auth)/login`, {
      waitUntil: 'domcontentloaded',
    });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        'age-gate-storage',
        JSON.stringify({
          state: { ageBand: '18_plus', termsVersion: '1' },
          version: 0,
        })
      );
      localStorage.setItem('news-seen:welcome', '1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email or username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    try {
      await page.waitForURL(/\/home$/, { timeout: 15_000 });
    } catch (error) {
      const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 800);
      throw new Error(`Login stayed at ${page.url()}: ${body}`, { cause: error });
    }

    captures.push(...(await captureCurrentScreen(page, 'home', 'home-screen')));

    for (const route of [
      { path: '/profile', name: 'profile', testId: 'profile-screen' },
      { path: '/settings', name: 'settings', testId: 'settings-screen' },
      { path: '/help', name: 'help', testId: 'help-screen' },
    ]) {
      await page.goto(`${mobileBaseUrl}${route.path}`, { waitUntil: 'domcontentloaded' });
      captures.push(...(await captureCurrentScreen(page, route.name, route.testId)));
    }

    await page.goto(`${mobileBaseUrl}/lobby`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('lobby-screen').waitFor({ timeout: 15_000 });
    captures.push(...(await captureCurrentScreen(page, 'lobby', 'lobby-screen')));

    await page.getByRole('button', { name: 'Start a table', exact: true }).first().click();
    await page.waitForURL(/\/new-table$/);
    for (const seat of ['east', 'south']) {
      await page.getByTestId(`new-table-seat-${seat}`).click();
      await page.getByTestId('seat-picker-container').getByRole('radio', { name: /^Bot,/ }).click();
    }
    captures.push(...(await captureCurrentScreen(page, 'create-table-live', 'new-table-screen')));

    await page.getByRole('button', { name: 'Open the table', exact: true }).click();
    await page.waitForURL(/\/game\/[A-Z0-9]+$/, { timeout: 20_000 });
    const gameUrl = page.url();
    const gameBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    if (/Open the table/i.test(gameBody) || /could not create/i.test(gameBody)) {
      throw new Error(`New table setup still visible after submit: ${gameBody}`);
    }

    await page
      .getByRole('button', { name: 'Leave table', exact: true })
      .waitFor({ timeout: 15_000 });
    captures.push(...(await captureCurrentScreen(page, 'waiting-table-live', 'waiting-table')));

    await page.getByRole('button', { name: 'Leave table', exact: true }).click({ timeout: 5_000 });
    await page.waitForURL(/\/lobby$/, { timeout: 10_000 });

    await leaveAnyCurrentRoom(token);
    const liveRoomCode = await createLiveGameRoom(token);
    await page.goto(`${mobileBaseUrl}/game/${liveRoomCode}`, { waitUntil: 'domcontentloaded' });
    await confirmInitialTable([page], '[data-testid="game-table"]', {
      onWaiting: async () => {
        captures.push(
          ...(await captureCurrentScreen(page, 'full-table-not-ready', 'waiting-table'))
        );
      },
    });
    await page.getByTestId('game-table').waitFor({ state: 'visible', timeout: 20_000 });
    captures.push(...(await captureCurrentScreen(page, 'game-table-live', 'game-table')));
    await page.getByRole('button', { name: 'Table settings', exact: true }).click();
    await page.getByRole('button', { name: 'Leave table', exact: true }).click();
    await page.getByText('Leave table?', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Leave table', exact: true }).click();
    await page.waitForURL(/\/lobby$/, { timeout: 10_000 });

    const unexpectedFailedResponses = failedResponses.filter(
      (response) => !isExpectedResponseFailure(response)
    );
    const actionableConsoleErrors = consoleErrors.filter(
      (error) =>
        !/Failed to load resource:.*status of (404|422)/.test(error) ||
        unexpectedFailedResponses.length > 0
    );

    if (actionableConsoleErrors.length || pageErrors.length || unexpectedFailedResponses.length) {
      throw new Error(
        [
          `Browser errors: console=${actionableConsoleErrors.length}, page=${pageErrors.length}`,
          ...actionableConsoleErrors.slice(0, 5).map((error) => `console: ${error}`),
          ...pageErrors.slice(0, 5).map((error) => `page: ${error}`),
          ...unexpectedFailedResponses
            .slice(0, 5)
            .map(({ status, url }) => `response: ${status} ${url}`),
        ].join('\n')
      );
    }

    console.log(`smoke:create-game ok game=${gameUrl} lobby=${page.url()}`);
    console.log(`smoke:live-game-table ok room=${liveRoomCode}`);
    console.log(`smoke:stale-room-recovery seeded=${seededRoomCode}`);
    console.log(`smoke:responsive-ui ok ${captures.length} captures`);
    captures.forEach((capture) => console.log(`  ${capture}`));
  } finally {
    await browser.close();
    await leaveAnyCurrentRoom(token);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
