import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { api, register } from '../support/api';
import { startSignedIn } from '../support/session';
import { newPlayer } from '../support/player';

async function cancelPicker(page: Page) {
  const picker = page.getByTestId('seat-picker-container');
  const back = picker.getByRole('link', { name: /^‹ / });
  if (await back.isVisible()) await back.click();
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
}

test('a bot and two open seats share a table link without a name form or seat binding', async ({
  page,
  player,
}) => {
  const session = await register(player);
  await startSignedIn(page, session);
  await page.goto('/lobby');
  await expect(page.getByTestId('lobby-screen')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Start a table', exact: true }).first().click();
  await expect(page).toHaveURL(/\/new-table$/);
  const form = page.getByTestId('new-table-screen');
  await expect(form.getByRole('textbox')).toHaveCount(0);

  const picker = page.getByTestId('seat-picker-container');
  for (const seat of ['east', 'south', 'west']) {
    await form.getByTestId(`new-table-seat-${seat}`).click();
    await expect(picker.getByRole('radio', { name: /^Anyone,/ })).toBeChecked();
    for (const title of [
      'Bot',
      'Anyone',
      '100+ games played',
      '1000+ games played',
      'With password',
    ]) {
      await expect(
        picker.getByRole('radio', {
          name: new RegExp(`^${title.replace('+', '\\+')},`),
        })
      ).toBeVisible();
    }
    if (seat === 'east') {
      await picker.getByRole('radio', { name: /^Bot,/ }).click();
    } else {
      if (!(await picker.getByTestId('friend-picker').isVisible())) {
        await picker.getByRole('button', { name: /^A friend,/ }).click();
      }
      await expect(picker.getByText('No friends yet', { exact: true })).toBeVisible();
      await cancelPicker(page);
    }
    await expect(picker).toBeHidden();
  }

  await form.getByRole('button', { name: 'Open the table', exact: true }).click();
  await page.waitForURL((url) => /^\/game\/[A-Z0-9]+$/.test(url.pathname));
  expect(new URL(page.url()).searchParams.has('invite')).toBe(false);
  await expect(page.getByTestId('waiting-table')).toBeVisible();
  await expect(page.getByTestId('invite-window')).toBeHidden();
  const firstMint = page.waitForResponse(
    (response) => response.url().endsWith('/invites') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Share the link', exact: true }).click();
  const inviteWindow = page.getByTestId('invite-window');
  await expect(inviteWindow).toBeVisible();
  // The window asks for no name; the table's talk box behind it is not the window's.
  await expect(inviteWindow.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
  const minted = await firstMint;
  expect(minted.ok()).toBe(true);
  expect(minted.request().postDataJSON().seat_hint ?? null).toBeNull();
  expect(minted.request().postDataJSON().position ?? null).toBeNull();
  const link = (await minted.json()).data.invite.code;
  expect(link).toBeTruthy();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('invite-window')).toBeHidden();

  const code = new URL(page.url()).pathname.split('/').pop();

  // The server seated the bot and kept the partner and invite seats open.
  const { payload } = await api(`/api/v1/rooms/${code}`, { token: session.token });
  const room = payload.data.room;
  const bots = Object.values(room.positions as Record<string, string | null>).filter((id) =>
    id?.startsWith('bot_')
  );
  expect(bots).toHaveLength(1);
  expect(room.available_positions).toHaveLength(2);
  const assigned = new Set<string>();
  for (let index = 0; index < 2; index++) {
    const recipient = await register(newPlayer());
    const redeemed = await api(`/api/v1/invites/${link}/redeem`, {
      method: 'POST',
      token: recipient.token,
      body: { platform: 'web' },
    });
    expect(redeemed.status).toBe(200);
    expect(['south', 'west']).toContain(redeemed.payload.data.position);
    assigned.add(redeemed.payload.data.position);
  }
  expect(assigned.size).toBe(2);
});
