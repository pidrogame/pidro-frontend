import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { api, register } from '../support/api';
import { AGE_ANSWERED, newPlayer } from '../support/player';
import { startSignedIn } from '../support/session';

async function closePicker(page: Page) {
  const picker = page.getByTestId('seat-picker-container');
  const back = picker.getByRole('link', { name: /^‹ / });
  if (await back.isVisible()) await back.click();
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(picker).toBeHidden();
}

async function friendRow(page: Page, name: string) {
  const picker = page.getByTestId('seat-picker-container');
  await page.getByTestId('new-table-seat-east').click();
  if (!(await picker.getByTestId('friend-picker').isVisible()))
    await picker.getByRole('button', { name: /^A friend,/ }).click();
  return picker.getByRole('button', { name: `Invite ${name}`, exact: true });
}

// No event says a friend's presence changed: the picker asks the server each time it opens.
test('PID-240: a friend who comes online while New table is open shows online when a picker opens', async ({
  page,
  player,
  browser,
}) => {
  const host = await register(player);
  const friendPlayer = newPlayer();
  const friend = await register(friendPlayer);
  for (const [token, id] of [
    [host.token, friend.user.id],
    [friend.token, host.user.id],
  ])
    expect((await api(`/api/v1/friends/${id}`, { method: 'PUT', token })).status).toBe(200);

  await startSignedIn(page, host);
  await page.goto('/new-table');
  await expect(page.getByTestId('new-table-screen')).toBeVisible({ timeout: 30_000 });
  await expect(await friendRow(page, friendPlayer.name)).toContainText('Not online');
  await closePicker(page);

  const friendContext = await browser.newContext({
    viewport: page.viewportSize()!,
    baseURL: test.info().project.use.baseURL,
  });
  try {
    const other = await friendContext.newPage();
    await other.addInitScript(
      ({ age, installId }) => {
        localStorage.setItem('age-gate-storage', age);
        localStorage.setItem('news-seen:welcome', '1');
        localStorage.setItem('install-id:v1', installId);
      },
      { age: AGE_ANSWERED, installId: friendPlayer.installId }
    );
    await startSignedIn(other, friend);
    await other.goto('/lobby');
    await expect(other.getByTestId('lobby-screen')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => {
        const list = await api('/api/v1/friends', { token: host.token });
        return list.payload.data.friends[0]?.presence;
      })
      .toBe('online');

    await expect(await friendRow(page, friendPlayer.name)).toContainText('Online now');
  } finally {
    await friendContext.close();
  }
});
