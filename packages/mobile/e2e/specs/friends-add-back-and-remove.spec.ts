import { test, expect } from '../fixtures';
import { api, register } from '../support/api';
import { newPlayer } from '../support/player';
import { startSignedIn } from '../support/session';

test.use({ unavailableExpected: true });

const emptyFriends =
  'Add the people you like playing with. Once they accept, you’ll see when they’re online and can invite them to your table.';

test('Friends receives a live request, accepts, removes after confirmation, and searches', async ({
  page,
  player,
}) => {
  const account = await register(player);
  const otherPlayer = newPlayer();
  const other = await register(otherPlayer);
  let lobbyJoined = false;
  let changes = 0;
  let disconnected = false;
  let disconnect = async () => {};
  await page.routeWebSocket('**/socket/websocket*', (socket) => {
    if (disconnected) return socket.close();
    const server = socket.connectToServer();
    disconnect = async () => {
      await Promise.all([socket.close(), server.close()]);
    };
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame[2] === 'lobby' && frame[3] === 'phx_reply' && frame[4]?.status === 'ok')
        lobbyJoined = true;
      if (frame[2] === 'lobby' && frame[3] === 'friends_changed') changes++;
      socket.send(message);
    });
  });
  await startSignedIn(page, account);
  await page.goto('/friends');
  await expect(page.getByText(emptyFriends)).toBeVisible();

  // Wait for the lobby join before sending the event from the other player.
  await expect.poll(() => lobbyJoined).toBe(true);
  const incoming = await api(`/api/v1/friends/${account.user.id}`, {
    method: 'PUT',
    token: other.token,
  });
  expect(incoming.status).toBe(200);
  const accept = page.getByRole('button', { name: `Accept ${otherPlayer.name}`, exact: true });
  await accept.waitFor();
  await expect(page.getByText('Asked today', { exact: true })).toBeVisible();
  // A failed event refetch must not discard the mutation's successful full list.
  await page.route('**/api/v1/friends', (route) =>
    route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } })
  );
  let releaseAdd: (() => void) | undefined;
  await page.route(`**/api/v1/friends/${other.user.id}`, async (route) => {
    const response = await route.fetch();
    await new Promise<void>((resolve) => {
      releaseAdd = resolve;
    });
    await route.fulfill({ response });
  });
  await accept.click();
  await expect.poll(() => changes).toBe(2);
  await expect.poll(() => Boolean(releaseAdd)).toBe(true);
  await page.getByRole('button', { name: `View ${otherPlayer.name}’s profile` }).click();
  const sheet = page.getByTestId('friend-sheet');
  await sheet.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  releaseAdd!();
  await expect(accept).toHaveCount(0);
  await expect(page.getByText('Could not update Friends. Please try again.')).toBeVisible();
  await page.unroute('**/api/v1/friends');
  await page.unroute(`**/api/v1/friends/${other.user.id}`);
  const lists = await api('/api/v1/friends', { token: account.token });
  expect(lists.payload.data.friends.map((friend: { user_id: string }) => friend.user_id)).toEqual([
    other.user.id,
  ]);

  await page.getByRole('button', { name: `View ${otherPlayer.name}’s profile` }).click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'See full profile', exact: true }).click();
  // PID-340: the player sheet says you are friends; Block waits behind its "…".
  const profile = page.getByTestId('player-sheet');
  await expect(profile).toBeVisible();
  await expect(profile.getByText(otherPlayer.name, { exact: true })).toBeVisible();
  await expect(profile.getByText('Friends', { exact: true })).toBeVisible();
  await expect(profile.getByRole('button', { name: /^(Remove|Block)/ })).toHaveCount(0);
  // Out of the sheet, as a tap above it does.
  await page
    .getByLabel('Close', { exact: true })
    .first()
    .click({ position: { x: 20, y: 20 } });
  await expect(profile).toHaveCount(0);
  await page.getByRole('button', { name: `View ${otherPlayer.name}’s profile` }).click();
  await sheet.getByRole('button', { name: 'Remove from friends', exact: true }).click();
  await expect(
    page.getByText(`Remove ${otherPlayer.name} from your friends?`, { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(`You’ll leave each other’s friends lists. ${otherPlayer.name} won’t be told.`, {
      exact: true,
    })
  ).toBeVisible();
  await page.getByRole('button', { name: `Keep ${otherPlayer.name}`, exact: true }).click();
  await expect(
    sheet.getByRole('button', { name: 'Remove from friends', exact: true })
  ).toBeVisible();
  expect(
    (await api('/api/v1/friends', { token: account.token })).payload.data.friends
  ).toHaveLength(1);
  await sheet.getByRole('button', { name: 'Remove from friends', exact: true }).click();
  await api(`/api/v1/friends/${account.user.id}`, { method: 'DELETE', token: other.token });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText(emptyFriends)).toBeVisible();
  await api(`/api/v1/friends/${account.user.id}`, { method: 'PUT', token: other.token });
  await page.getByRole('button', { name: `View ${otherPlayer.name}’s profile` }).click();
  await sheet.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(accept).toHaveCount(0);
  await page.getByRole('button', { name: `View ${otherPlayer.name}’s profile` }).click();
  await sheet.getByRole('button', { name: 'Remove from friends', exact: true }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText(emptyFriends)).toBeVisible();
  expect((await api('/api/v1/friends', { token: other.token })).payload.data.friends).toHaveLength(
    0
  );

  // A missed event must be recovered on rejoin without navigating away.
  disconnected = true;
  await disconnect();
  await api(`/api/v1/friends/${account.user.id}`, { method: 'PUT', token: other.token });
  disconnected = false;
  await accept.waitFor();
  await api(`/api/v1/friends/${account.user.id}`, { method: 'DELETE', token: other.token });
  await expect(page.getByText(emptyFriends)).toBeVisible();

  const add = page.getByRole('button', { name: 'Add a friend', exact: true });
  await expect(add).toHaveText('Add');
  await add.click();
  await expect(page.getByText('Played with recently', { exact: true })).toBeVisible();
  await expect(page.getByText('People you play with will appear here after a game.')).toBeVisible();
  await page.clock.install();
  await page.getByRole('textbox', { name: 'Find a player by name', exact: true }).fill(' ');
  await page.clock.runFor(350);
  await expect(page.getByText('People you play with will appear here after a game.')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Find a player by name', exact: true })
    .fill(otherPlayer.name);
  await page.getByRole('button', { name: `Add ${otherPlayer.name}`, exact: true }).click();
  await expect(page.getByText('Sent', { exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Find a player by name', exact: true })
    .fill(`${otherPlayer.name} `);
  await page.clock.runFor(350);
  await expect(page.getByText('Sent', { exact: true })).toBeVisible();
  expect(
    (await api('/api/v1/friends', { token: other.token })).payload.data.added_you.map(
      (entry: { user_id: string }) => entry.user_id
    )
  ).toEqual([account.user.id]);
});
