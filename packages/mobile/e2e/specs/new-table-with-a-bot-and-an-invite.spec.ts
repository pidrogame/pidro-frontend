import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { api, register } from '../support/api';
import { startSignedIn } from '../support/session';
import { AGE_ANSWERED, newPlayer } from '../support/player';

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
  await page.getByRole('button', { name: 'Share the table link', exact: true }).click();
  await expect(page.getByTestId('invite-window')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
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

  // After opening every choice is one seat request; the row and the reopened picker follow the server.
  const code = new URL(page.url()).pathname.split('/').pop();
  const east = page.getByTestId('new-table-seat-east');
  // Before the first password seat there are no digits; after it, the host's room carries them.
  let digits = '';
  const choice = (title: string) =>
    picker.getByRole('radio', {
      name: new RegExp(`^${title.replace('+', '\\+')}${title === 'With password' ? digits : ''},`),
    });
  for (const [title, seat, row] of [
    ['1000+ games played', { type: 'open', min_games: 1000 }, /Waiting…$/],
    ['With password', { type: 'open', min_games: 0, password: true }, /password \d{4}$/],
    ['Anyone', 'open', /Waiting…$/],
    ['Bot', 'ai', /Ready$/],
  ] as const) {
    await east.click();
    const sent = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === `/api/v1/rooms/${code}/seats/east`
    );
    await choice(title).click();
    const response = await sent;
    expect(response.request().postDataJSON()).toEqual({ seat });
    expect(response.status()).toBe(200);
    const answered = (await response.json()).data.room.seat_password;
    if (answered) digits = ` ${answered}`;
    await expect(picker).toBeHidden();
    await expect(east).toHaveText(row);
    await east.click();
    await expect(choice(title)).toBeChecked();
    await cancelPicker(page);
  }
  expect(digits).toMatch(/^ \d{4}$/);

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

test('picked friends become holds only on Open; invitations arrive live, recover on launch and join the exact seat @responsive', async ({
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
  const receiverContext = await browser.newContext({
    viewport: page.viewportSize()!,
    baseURL: test.info().project.use.baseURL,
  });
  const receiver = await receiverContext.newPage();
  await receiver.addInitScript((age) => {
    localStorage.setItem('age-gate-storage', age);
    localStorage.setItem('news-seen:welcome', '1');
  }, AGE_ANSWERED);
  await startSignedIn(receiver, friend);
  let joinedLobby = false;
  await receiver.routeWebSocket('**/socket/websocket*', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame[2] === 'lobby' && frame[3] === 'phx_reply' && frame[4]?.status === 'ok')
        joinedLobby = true;
      socket.send(message);
    });
  });
  try {
    await receiver.goto('/home');
    await expect.poll(() => joinedLobby).toBe(true);
    await startSignedIn(page, host);
    await page.goto('/lobby');
    await page.getByRole('button', { name: 'Start a table', exact: true }).first().click();
    await expect(page).toHaveURL(/\/new-table$/);
    const form = page.getByTestId('new-table-screen');
    const sheet = page.getByTestId('seat-picker-container');
    const friends = sheet.getByTestId('friend-picker');
    const openFriends = async (position: string) => {
      await page.getByTestId(`new-table-seat-${position}`).click();
      await expect(sheet).toBeVisible();
      if (!(await friends.isVisible())) {
        await sheet.getByRole('button', { name: /^A friend,/ }).click();
      }
      await expect(friends).toBeVisible();
    };
    let created = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/rooms')
        created++;
    });
    await openFriends('west');
    await cancelPicker(page);
    await form.getByTestId('new-table-seat-west').click();
    await expect(sheet.getByRole('radio', { name: /^Anyone,/ })).toBeChecked();
    await cancelPicker(page);
    await openFriends('west');
    await friends
      .getByRole('textbox', { name: 'Find a friend', exact: true })
      .fill(friendPlayer.name);
    await friends.getByRole('button', { name: `Invite ${friendPlayer.name}`, exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(form.getByTestId('new-table-seat-west')).toContainText(friendPlayer.name);
    await openFriends('south');
    await expect(
      friends.getByRole('button', {
        name: `${friendPlayer.name}, Already invited to another seat`,
        exact: true,
      })
    ).toBeDisabled();
    await cancelPicker(page);
    await openFriends('west');
    await expect(
      friends.getByRole('button', { name: friendPlayer.name, exact: true })
    ).toBeEnabled();
    await cancelPicker(page);
    expect(created).toBe(0);
    await form.getByRole('button', { name: 'Open the table', exact: true }).click();
    await page.waitForURL(/\/game\/[A-Z0-9]+$/);
    const code = new URL(page.url()).pathname.split('/').pop()!;
    expect(
      (await api(`/api/v1/rooms/${code}`, { token: host.token })).payload.data.room.seats.west
        .held_for.user_id
    ).toBe(friend.user.id);
    await openFriends('south');
    await expect(
      friends.getByRole('button', {
        name: `${friendPlayer.name}, Already invited to another seat`,
        exact: true,
      })
    ).toBeDisabled();
    await cancelPicker(page);
    const inbox = receiver.getByTestId('seat-invitations');
    // Home shows the invitation once, as the notice; Tables lists it.
    const notice = receiver.getByTestId('friend-notice');
    await expect(
      notice.getByText(`${player.name} is holding a seat for you`, { exact: true })
    ).toBeVisible();
    await expect(inbox).toHaveCount(0);
    await expect(receiver.getByTestId('friends-invitation-count')).toHaveText('1');
    await expect(
      receiver.getByRole('button', { name: 'Friends, 1 waiting for your answer', exact: true })
    ).toBeVisible();
    await receiver.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(receiver).toHaveURL(/\/settings$/);
    // The shell badge stays live even away from the invitation list.
    await page.getByTestId('new-table-seat-west').click();
    await sheet.getByRole('radio', { name: /^Anyone,/ }).click();
    await expect(page.getByTestId('new-table-seat-west')).toContainText('Open seat');
    await expect(receiver.getByTestId('friends-invitation-count')).toHaveCount(0);
    await openFriends('south');
    await friends.getByRole('button', { name: `Invite ${friendPlayer.name}`, exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(receiver.getByTestId('friends-invitation-count')).toHaveText('1');
    await receiver.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(receiver).toHaveURL(/\/home$/);
    await receiver.reload();
    await expect(notice).toBeVisible();
    // Lost seats use the same error contract whether waiting or already playing.
    for (const error of ['SEAT_TAKEN', 'ROOM_FULL']) {
      await receiver.route(
        `**/api/v1/rooms/${code}/join`,
        async (route) => {
          expect(route.request().postDataJSON()).toEqual({ position: 'south' });
          await route.fulfill({
            status: 422,
            json: { error, error_code: error, error_params: {} },
          });
        },
        { times: 1 }
      );
      await notice.getByRole('button', { name: 'Sit down', exact: true }).click();
      await expect(
        notice.getByText(`${player.name}’s game started without you`, { exact: true })
      ).toBeVisible();
      await expect(notice.getByRole('button', { name: 'Sit down', exact: true })).toHaveCount(0);
      // The badge follows the refetched server list, not this mocked refusal.
      await expect(receiver.getByTestId('friends-invitation-count')).toHaveText('1');
      await expect(receiver).toHaveURL(/\/home$/);
      // The mocked refusal did not change the real hold; /me restores it on reload.
      await receiver.reload();
      await expect(notice.getByRole('button', { name: 'Sit down', exact: true })).toBeVisible();
    }
    await receiver.goto('/lobby');
    // Tables is outside the shell, and its too-late card still goes by itself.
    await receiver.route(
      `**/api/v1/rooms/${code}/join`,
      (route) =>
        route.fulfill({
          status: 422,
          json: { error: 'SEAT_TAKEN', error_code: 'SEAT_TAKEN', error_params: {} },
        }),
      { times: 1 }
    );
    await inbox.getByRole('button', { name: 'Sit down', exact: true }).click();
    const late = receiver.getByText(`${player.name}’s game started without you`, { exact: true });
    await expect(late).toBeVisible();
    await expect(late).toBeHidden({ timeout: 8_000 });
    await receiver.reload();
    await inbox.getByRole('button', { name: 'Sit down', exact: true }).click();
    await receiver.waitForURL(new RegExp(`/game/${code}$`));
    expect(
      (await api(`/api/v1/rooms/${code}`, { token: host.token })).payload.data.room.positions.south
    ).toBe(friend.user.id);
    expect(
      (await api('/api/v1/auth/me', { token: friend.token })).payload.data.seat_invitations
    ).toEqual([]);
    await openFriends('east');
    await expect(
      friends.getByRole('button', {
        name: `${friendPlayer.name}, Already invited to another seat`,
        exact: true,
      })
    ).toBeDisabled();
  } finally {
    await receiverContext.close();
  }
});

test('Play on a friend prefills Partner; requirements and a server password survive public room updates', async ({
  page,
  player,
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
  await startSignedIn(page, host);
  await page.goto(`/new-table?partner=${friend.user.id}`);
  const partner = page.getByTestId('new-table-seat-south');
  await expect(partner).toContainText(friendPlayer.name);
  await expect(partner).toContainText('Invited when you open the table');
  const picker = page.getByTestId('seat-picker-container');
  await page.getByTestId('new-table-seat-east').click();
  await picker.getByRole('radio', { name: /^100\+ games played,/ }).click();
  await page.getByTestId('new-table-seat-west').click();
  await picker.getByRole('radio', { name: /^With password,/ }).click();
  await expect(page.getByTestId('new-table-seat-west')).toContainText('Password');
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/rooms'
  );
  await page.getByRole('button', { name: 'Open the table', exact: true }).click();
  const response = await created;
  expect(response.request().postDataJSON().seats).toEqual({
    seat_2: { type: 'open', min_games: 100 },
    seat_3: { type: 'held', user_id: friend.user.id },
    seat_4: { type: 'open', min_games: 0, password: true },
  });
  const password = (await response.json()).data.room.seat_password;
  expect(password).toMatch(/^\d{4}$/);
  await expect(page.getByTestId('waiting-table')).toBeVisible();
  await expect(page.getByTestId('waiting-rule-set')).toHaveText('Listed in Tables · Ostrobothnian');
  await expect(page.getByTestId('new-table-seat-west')).toContainText(
    `Waiting… · password ${password}`
  );
  const code = new URL(page.url()).pathname.split('/').pop();
  expect(
    (
      await api(`/api/v1/rooms/${code}/join`, {
        method: 'POST',
        token: friend.token,
        body: { position: 'south' },
      })
    ).status
  ).toBe(200);
  await expect(partner).toContainText('Not ready');
  await expect(page.getByTestId('new-table-seat-west')).toContainText(
    `Waiting… · password ${password}`
  );
  // The host's own room read restores the digits after a reload; nobody else's carries them.
  await page.reload();
  await expect(partner).toContainText('Not ready');
  await expect(page.getByTestId('new-table-seat-west')).toContainText(
    `Waiting… · password ${password}`
  );
  const friendRead = await api(`/api/v1/rooms/${code}`, { token: friend.token });
  expect(friendRead.status).toBe(200);
  expect(friendRead.payload.data.room.code).toBe(code);
  expect(friendRead.payload.data.room).not.toHaveProperty('seat_password');
});

test('a delayed partner lookup preserves an explicit seat choice and a cold entry can go back', async ({
  page,
  player,
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
  await startSignedIn(page, host);
  for (const choice of ['Bot', 'Anyone']) {
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/friends', async (route) => {
      const response = await route.fetch();
      await delayed;
      await route.fulfill({ response });
    });
    await page.goto(`/new-table?partner=${friend.user.id}`);
    const partner = page.getByTestId('new-table-seat-south');
    await partner.click();
    const picker = page.getByTestId('seat-picker-container');
    await picker.getByRole('radio', { name: new RegExp(`^${choice},`) }).click();
    release();
    // Seeing the friend in another seat's picker proves the delayed list reached the UI.
    await page.getByTestId('new-table-seat-west').click();
    await picker.getByRole('button', { name: /^A friend,/ }).click();
    await expect(
      picker.getByRole('button', { name: `Invite ${friendPlayer.name}`, exact: true })
    ).toBeVisible();
    await cancelPicker(page);
    await expect(partner).not.toContainText(friendPlayer.name);
    if (choice === 'Anyone') await expect(partner).toContainText('Open seat');
    else await expect(partner).toContainText('Plays right away');
    // Each picker asks for friends as it opens; one may still be on its way.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
  await page.getByRole('button', { name: 'Cancel creation', exact: true }).click();
  await expect(page).toHaveURL(/\/lobby$/);
});
