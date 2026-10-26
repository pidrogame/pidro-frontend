import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { API, api, register } from '../support/api';
import { AGE_ANSWERED, newPlayer } from '../support/player';
import { startSignedIn } from '../support/session';

// A request notice shows once /friends confirms it, after the friends_changed refetch: two round
// trips, over a second on a cold runner. Nothing polls, so seeing it at all proves it is live.
const REQUEST_NOTICE = { timeout: 5_000 };

// Observe the real lobby join; never inject a friends event or stub its refetch.
async function homeAfterLobbyJoin(page: Page, account: Awaited<ReturnType<typeof register>>) {
  let joined = false;
  await page.routeWebSocket('**/socket/websocket*', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame[2] === 'lobby' && frame[3] === 'phx_reply' && frame[4]?.status === 'ok')
        joined = true;
      socket.send(message);
    });
  });
  await startSignedIn(page, account);
  await Promise.all([
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/v1/friends' && response.ok()
    ),
    page.goto('/home'),
  ]);
  await expect(page.getByTestId('home-play-online')).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);
  await expect.poll(() => joined).toBe(true);
}

test('PID-246: Home accepts a live friend request and the sender sees a four-second accepted notice', async ({
  page,
  player,
  browser,
}) => {
  const account = await register(player);
  const otherPlayer = newPlayer();
  const other = await register(otherPlayer);
  const otherContext = await browser.newContext({
    viewport: page.viewportSize()!,
    baseURL: test.info().project.use.baseURL,
  });
  try {
    const sender = await otherContext.newPage();
    await sender.addInitScript(
      ({ age, installId }) => {
        localStorage.setItem('age-gate-storage', age);
        localStorage.setItem('news-seen:welcome', '1');
        localStorage.setItem('install-id:v1', installId);
      },
      { age: AGE_ANSWERED, installId: otherPlayer.installId }
    );
    // The manually created page does not inherit the fixture's error checks.
    const problems: string[] = [];
    sender.on('pageerror', (error) => problems.push(error.message));
    sender.on('response', (response) => {
      if (response.url().startsWith(API) && response.status() >= 500)
        problems.push(`${response.status()} ${response.url()}`);
    });
    await Promise.all([homeAfterLobbyJoin(page, account), homeAfterLobbyJoin(sender, other)]);
    const notice = page.getByTestId('friend-notice');
    const badge = page.getByTestId('friends-invitation-count');
    await expect(notice).toHaveCount(0);
    await expect(badge).toHaveCount(0);
    expect(
      (await api(`/api/v1/friends/${account.user.id}`, { method: 'PUT', token: other.token }))
        .status
    ).toBe(200);
    await expect(notice).toBeVisible(REQUEST_NOTICE);
    await expect(notice).toContainText(`${otherPlayer.name} wants to be friends`);
    await expect(badge).toHaveText('1');

    // Freeze only B's timers before acceptance so the notice cannot expire while
    // A's mutation and the backend assertions are being checked.
    await sender.clock.install();
    await sender.clock.pauseAt(new Date(Date.now() + 1_000));
    await notice.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(notice).toHaveCount(0);
    await expect(badge).toHaveCount(0);
    await expect(page).toHaveURL(/\/home$/);
    const accepted = sender.getByTestId('friend-notice');
    await expect(accepted).toBeVisible();
    await expect(accepted).toContainText(`${player.name} accepted. You’re friends now.`);
    const list = await api('/api/v1/friends', { token: other.token });
    expect(list.status).toBe(200);
    expect(list.payload.data.friends.map((friend: { user_id: string }) => friend.user_id)).toEqual([
      account.user.id,
    ]);
    await sender.clock.runFor(3_999);
    await expect(accepted).toBeVisible();
    await sender.clock.runFor(1);
    await expect(accepted).toHaveCount(0);
    expect(problems).toEqual([]);
  } finally {
    await otherContext.close();
  }
});

test('PID-246: Not now preserves the request badge; cancelling a live request removes its notice', async ({
  page,
  player,
}) => {
  const account = await register(player);
  const other = await register(newPlayer());
  await homeAfterLobbyJoin(page, account);
  const notice = page.getByTestId('friend-notice');
  const badge = page.getByTestId('friends-invitation-count');
  const requestPath = `/api/v1/friends/${account.user.id}`;
  expect((await api(requestPath, { method: 'PUT', token: other.token })).status).toBe(200);
  await expect(notice).toBeVisible(REQUEST_NOTICE);
  await expect(badge).toHaveText('1');
  await notice.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(badge).toHaveText('1');
  const pending = await api('/api/v1/friends', { token: account.token });
  expect(pending.status).toBe(200);
  expect(pending.payload.data.added_you.map((entry: { user_id: string }) => entry.user_id)).toEqual(
    [other.user.id]
  );

  // A fresh request exercises cancellation while the notice is still visible,
  // rather than merely checking removal of an already-dismissed notice.
  expect((await api(requestPath, { method: 'DELETE', token: other.token })).status).toBe(200);
  await expect(badge).toHaveCount(0);
  const fresh = await register(newPlayer());
  await page.getByTestId('home-play-online').click();
  await expect(page).toHaveURL(/\/lobby$/);
  expect((await api(requestPath, { method: 'PUT', token: fresh.token })).status).toBe(200);
  await expect(notice).toHaveCount(0);
  await page.goBack();
  await expect(notice).toBeVisible(REQUEST_NOTICE);
  await expect(badge).toHaveText('1');
  expect((await api(requestPath, { method: 'DELETE', token: fresh.token })).status).toBe(200);
  await expect(notice).toHaveCount(0);
  await expect(badge).toHaveCount(0);
  await expect(page).toHaveURL(/\/home$/);
});

test('PID-254: Not now and sitting down elsewhere open the seat again and tell the host at once', async ({
  page,
  player,
  browser,
}) => {
  const host = await register(player);
  const friendPlayer = newPlayer();
  const friend = await register(friendPlayer);
  for (const [caller, target] of [
    [host, friend],
    [friend, host],
  ]) {
    expect(
      (await api(`/api/v1/friends/${target.user.id}`, { method: 'PUT', token: caller.token }))
        .status
    ).toBe(200);
  }
  const created = await api('/api/v1/rooms', {
    method: 'POST',
    token: host.token,
    body: {
      seats: { seat_2: 'ai', seat_3: { type: 'held', user_id: friend.user.id }, seat_4: 'ai' },
    },
  });
  expect(created.status).toBe(201);
  const code = created.payload.data.code;
  const friendContext = await browser.newContext({
    viewport: page.viewportSize()!,
    baseURL: test.info().project.use.baseURL,
  });
  try {
    const invitee = await friendContext.newPage();
    await invitee.addInitScript(
      ({ age, installId }) => {
        localStorage.setItem('age-gate-storage', age);
        localStorage.setItem('news-seen:welcome', '1');
        localStorage.setItem('install-id:v1', installId);
      },
      { age: AGE_ANSWERED, installId: friendPlayer.installId }
    );
    await homeAfterLobbyJoin(invitee, friend);
    const invitation = invitee.getByTestId('friend-notice');
    await expect(invitation).toContainText(`${player.name} is holding a seat for you`);
    await startSignedIn(page, host);
    await page.goto(`/game/${code}`);
    const partner = page.getByTestId('new-table-seat-south');
    await expect(partner).toContainText(friendPlayer.name);
    const declined = page.getByTestId('seat-declined-notice');

    await invitation.getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(invitation).toHaveCount(0);
    await expect(declined).toBeVisible({ timeout: 1_000 });
    await expect(declined).toContainText(`${friendPlayer.name} can’t come right now`);
    await expect(declined).toContainText('The seat is open again');
    await expect(partner).toContainText('Open seat');
    expect(
      (await api('/api/v1/auth/me', { token: friend.token })).payload.data.seat_invitations
    ).toEqual([]);
    await declined.getByRole('button', { name: 'Invite someone else', exact: true }).click();
    await expect(declined).toHaveCount(0);
    const sheet = page.getByTestId('seat-picker-container');
    await expect(sheet.getByTestId('friend-picker')).toBeVisible();
    await expect(sheet).toContainText('Partner seat');

    // Asked again, she sits down with someone else before answering.
    await sheet.getByRole('button', { name: `Invite ${friendPlayer.name}`, exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(partner).toContainText(friendPlayer.name);
    await expect(invitation).toContainText(`${player.name} is holding a seat for you`);
    const other = await register(newPlayer());
    const elsewhere = await api('/api/v1/rooms', {
      method: 'POST',
      token: other.token,
      body: { seats: { seat_2: 'open', seat_3: 'ai', seat_4: 'ai' } },
    });
    expect(elsewhere.status).toBe(201);
    expect(
      (
        await api(`/api/v1/rooms/${elsewhere.payload.data.code}/join`, {
          method: 'POST',
          token: friend.token,
          body: { position: 'east' },
        })
      ).status
    ).toBe(200);
    await expect(declined).toBeVisible({ timeout: 1_000 });
    await expect(declined).toContainText(`${friendPlayer.name} can’t come right now`);
    await expect(partner).toContainText('Open seat');
    // Her own answer goes quietly on her side.
    await expect(invitation).toHaveCount(0);
    await expect(invitee.getByText(/started without you/)).toHaveCount(0);
  } finally {
    await friendContext.close();
  }
});

test('PID-258: a seat held for you reaches your game with the bots; Not now tells the host, Join sits you there and costs nothing', async ({
  page,
  player,
}) => {
  const you = await register(player);
  const hostPlayer = newPlayer();
  const host = await register(hostPlayer);
  for (const [caller, target] of [
    [you, host],
    [host, you],
  ]) {
    expect(
      (await api(`/api/v1/friends/${target.user.id}`, { method: 'PUT', token: caller.token }))
        .status
    ).toBe(200);
  }
  const stats = async () => {
    const result = await api('/api/v1/users/me/stats', { token: you.token });
    expect(result.status).toBe(200);
    const { games_played, games_abandoned } = result.payload.data;
    return { games_played, games_abandoned };
  };
  await homeAfterLobbyJoin(page, you);
  await page.getByTestId('home-quick-game').click();
  await page.waitForURL(/\/game\/[A-Z0-9]+/);
  const solo = /\/game\/([A-Z0-9]+)/.exec(page.url())![1];
  await page.getByRole('button', { name: "I'm ready", exact: true }).click();
  await expect(page.getByTestId('game-table')).toBeVisible();
  const before = await stats();
  const card = page.getByTestId('table-invitation');
  await expect(card).toHaveCount(0);

  const created = await api('/api/v1/rooms', {
    method: 'POST',
    token: host.token,
    body: { seats: { seat_2: 'ai', seat_3: { type: 'held', user_id: you.user.id }, seat_4: 'ai' } },
  });
  expect(created.status).toBe(201);
  const code = created.payload.data.code;
  await expect(card).toBeVisible({ timeout: 1_000 });
  await expect(card).toContainText(`${hostPlayer.name} is holding a seat for you`);
  await expect(card).toContainText(`as ${hostPlayer.name}’s partner`);
  await expect(card).toContainText('Joining ends your game with the bots.');

  await card.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect
    .poll(
      async () => (await api('/api/v1/auth/me', { token: you.token })).payload.data.seat_invitations
    )
    .toEqual([]);
  await expect(page.getByTestId('game-table')).toBeVisible();
  expect(page.url()).toContain(`/game/${solo}`);

  // Asked again, Join leaves the bots and sits down in the held seat.
  expect(
    (
      await api(`/api/v1/rooms/${code}/seats/south/hold`, {
        method: 'PUT',
        token: host.token,
        body: { user_id: you.user.id },
      })
    ).status
  ).toBe(200);
  await expect(card).toBeVisible({ timeout: 1_000 });
  await card.getByRole('button', { name: `Join ${hostPlayer.name}`, exact: true }).click();
  await page.waitForURL(new RegExp(`/game/${code}$`));
  await expect(page.getByTestId('new-table-seat-south')).toContainText(player.name);
  await expect(page.getByText(/started without you/)).toHaveCount(0);
  expect((await api(`/api/v1/rooms/${solo}`, { token: you.token })).status).toBe(404);
  expect(await stats()).toEqual(before);
});
