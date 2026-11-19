import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { api, register } from '../support/api';
import { tableCode } from '../support/game';
import { startSignedIn } from '../support/session';

async function createLouisianaTable(page: Page, token: string) {
  await page
    .getByTestId('lobby-screen')
    .last()
    .getByRole('button', { name: 'Start a table', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/new-table$/);
  const create = page.getByTestId('new-table-screen');
  const rules = create.getByRole('radiogroup', { name: 'Rules', exact: true });
  await rules.getByRole('radio', { name: 'Louisiana', exact: true }).click();
  await expect(rules.getByRole('radio', { name: 'Louisiana', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/rooms' && response.request().method() === 'POST'
  );
  await create.getByRole('button', { name: 'Open the table', exact: true }).click();
  const response = await created;
  expect(response.request().postDataJSON().rule_set).toBe('louisiana');
  expect(response.status()).toBe(201);
  await page.waitForURL(/\/game\/[A-Z0-9]+/);
  const code = tableCode(page);
  const server = await api(`/api/v1/rooms/${code}`, { token });
  expect(server.status).toBe(200);
  const room =
    server.payload.data?.room ?? server.payload.room ?? server.payload.data ?? server.payload;
  expect(room.code).toBe(code);
  expect(room.config.rule_set).toBe('louisiana');
  await expect(page.getByTestId('waiting-table').last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('waiting-rule-set').last()).toContainText('Louisiana');
  return code;
}

test('a Louisiana table shows its rules and explains them only once @responsive', async ({
  page,
  player,
}) => {
  const { token, user } = await register(player);
  await startSignedIn(page, { token, user });
  await page.goto('/device-settings');
  await expect(
    page
      .getByTestId('settings-preferred-rules')
      .getByRole('button', { name: 'Finnish', exact: true })
  ).toHaveAttribute('aria-selected', 'true');
  await page.goto('/lobby');
  await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 30_000 });

  const first = await createLouisianaTable(page, token);
  // Creation lands at the waiting table, where the first explanation appears.
  await expect(page.getByTestId('rules-explainer')).toBeVisible();
  await expect(page.getByTestId('rules-explainer-rule-set')).toContainText('Louisiana');

  // The server hides waiting tables without a connected human. Keep this seat
  // connected while finding the table from another tab on the same device.
  const seatedPage = page;
  page = await page.context().newPage();
  await page.goto('/lobby');
  await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`room-rules-${first}`)).toContainText('Louisiana');
  await page.close();
  page = seatedPage;
  await expect(page.getByTestId('waiting-rule-set').last()).toContainText('Louisiana');
  await expect(page.getByTestId('rules-explainer')).toBeVisible();
  await page.getByTestId('rules-done').click();
  await expect(page.getByTestId('rules-explainer')).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('settings-storage') ?? '{}').state?.hasSeenLouisianaRules
      )
    )
    .toBe(true);

  const left = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/v1/rooms/${first}/leave`
  );
  await page
    .getByTestId('waiting-table')
    .last()
    .getByRole('button', { name: 'Leave table', exact: true })
    .click();
  expect((await left).ok()).toBe(true);
  await page.waitForURL(/\/lobby$/);
  await expect(page.getByTestId('lobby-screen').last()).toBeVisible();
  const second = await createLouisianaTable(page, token);
  expect(second).not.toBe(first);
  // Absence is meaningful only after the real second waiting table has loaded.
  await expect(page.getByTestId('rules-explainer')).not.toBeVisible();
  await page.reload();
  await page.waitForURL(`**/game/${second}`);
  await expect(page.getByTestId('waiting-table').last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('waiting-rule-set').last()).toContainText('Louisiana');
  await expect(page.getByTestId('rules-explainer')).not.toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('settings-storage') ?? '{}').state)
  ).toMatchObject({
    preferredRuleSet: 'finnish',
    hasSeenLouisianaRules: true,
  });
});
