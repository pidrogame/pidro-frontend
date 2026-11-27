import { test, expect } from '../fixtures';
import { api, register } from '../support/api';
import { newPlayer } from '../support/player';
import { startSignedIn } from '../support/session';

test.use({ unavailableExpected: true });

test('blocking removes the friendship; unblocking restores nothing', async ({
  page,
  player,
}) => {
  const account = await register(player);
  const otherPlayer = newPlayer();
  const other = await register(otherPlayer);
  for (const [caller, target] of [
    [account, other],
    [other, account],
  ]) {
    expect(
      (await api(`/api/v1/friends/${target.user.id}`, { method: 'PUT', token: caller.token }))
        .status
    ).toBe(200);
  }
  await startSignedIn(page, account);
  await page.goto('/friends');
  await page.getByRole('button', { name: `View ${otherPlayer.name}’s profile` }).click();
  const sheet = page.getByTestId('friend-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: `Block ${otherPlayer.name}`, exact: true }).click();
  await expect(page.getByText(`Block ${otherPlayer.name}?`, { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      `${otherPlayer.name} won’t be able to find you, add you or sit at your tables, and you won’t be friends anymore. You can unblock ${otherPlayer.name} any time in Profile.`,
      { exact: true }
    )
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    sheet.getByRole('button', { name: `Block ${otherPlayer.name}`, exact: true })
  ).toBeVisible();
  expect((await api('/api/v1/blocks', { token: account.token })).payload.data.blocked).toEqual([]);
  expect(
    (await api('/api/v1/friends', { token: account.token })).payload.data.friends
  ).toHaveLength(1);
  await sheet.getByRole('button', { name: `Block ${otherPlayer.name}`, exact: true }).click();
  await page.route(`**/api/v1/blocks/${other.user.id}`, (route) =>
    route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } })
  );
  await page.getByRole('button', { name: 'Block', exact: true }).click();
  await expect(
    page.getByText('Could not block this player. Please try again.').last()
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Block', exact: true })).toBeEnabled();
  expect((await api('/api/v1/blocks', { token: account.token })).payload.data.blocked).toEqual([]);
  expect(
    (await api('/api/v1/friends', { token: account.token })).payload.data.friends
  ).toHaveLength(1);
  await page.unroute(`**/api/v1/blocks/${other.user.id}`);
  await page.getByRole('button', { name: 'Block', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(
    page.getByText(
      'Add the people you like playing with. Once they accept, you’ll see when they’re online and can invite them to your table.'
    )
  ).toBeVisible();
  expect((await api('/api/v1/friends', { token: other.token })).payload.data.friends).toEqual([]);
  expect(
    (
      await api(`/api/v1/users/search?q=${encodeURIComponent(otherPlayer.name)}`, {
        token: account.token,
      })
    ).payload.data.users
  ).toEqual([]);

  await page.goto('/profile');
  await page.getByRole('link', { name: 'Blocked players', exact: true }).click();
  const unblock = page.getByRole('button', { name: `Unblock ${otherPlayer.name}`, exact: true });
  await expect(unblock).toBeVisible();
  await expect(page.getByText('Unblocking does not add them back as a friend.')).toBeVisible();
  await page.route(`**/api/v1/blocks/${other.user.id}`, (route) =>
    route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } })
  );
  await unblock.click();
  await expect(page.getByText('Could not update blocked players. Please try again.')).toBeVisible();
  await expect(unblock).toBeEnabled();
  await page.unroute(`**/api/v1/blocks/${other.user.id}`);
  await unblock.click();
  await expect(page.getByText('You have not blocked anyone.')).toBeVisible();
  expect((await api('/api/v1/blocks', { token: account.token })).payload.data.blocked).toEqual([]);
  expect((await api('/api/v1/friends', { token: account.token })).payload.data.friends).toEqual([]);
  const results = (
    await api(`/api/v1/users/search?q=${encodeURIComponent(otherPlayer.name)}`, {
      token: account.token,
    })
  ).payload.data.users;
  expect(results).toEqual([expect.objectContaining({ user_id: other.user.id, relation: 'none' })]);
});
