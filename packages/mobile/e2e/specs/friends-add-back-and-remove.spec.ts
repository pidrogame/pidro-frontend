import { test, expect } from '../fixtures';
import { AuthSheet } from '../screens/auth-sheet';
import { api, guest, register } from '../support/api';
import { AGE_ANSWERED, newPlayer } from '../support/player';
import { sessionOf, startSignedIn } from '../support/session';

test.use({ unavailableExpected: true });

const emptyFriends =
  'Add the people you like playing with. Once they accept, you’ll see when they’re online and can invite them to your table.';

for (const source of ['search', 'recent'] as const) {
  test(`${source} keeps row order and updates real add/accept relations without discovery refetches`, async ({
    page,
    player,
  }) => {
    const account = await register(player);
    const prefix = `P${player.id}`;
    const outgoingPlayer = { ...newPlayer(), name: `${prefix}A` };
    const incomingPlayer = { ...newPlayer(), name: `${prefix}B` };
    const outgoing = await register(outgoingPlayer);
    const incoming = await register(incomingPlayer);
    expect(
      (await api(`/api/v1/friends/${account.user.id}`, { method: 'PUT', token: incoming.token }))
        .status
    ).toBe(200);

    if (source === 'recent') {
      // Only game history is synthetic; both relationship mutations reach the real backend.
      await page.route('**/api/v1/friends/recent', async (route) => {
        const lists = (await api('/api/v1/friends', { token: account.token })).payload.data;
        await route.fulfill({
          json: {
            data: {
              users: [outgoing, incoming].map((user, index) => ({
                user_id: user.user.id,
                display_name: [outgoingPlayer.name, incomingPlayer.name][index],
                avatar_url: null,
                presence: 'offline',
                relation: lists.friends.some(
                  (entry: { user_id: string }) => entry.user_id === user.user.id
                )
                  ? 'friend'
                  : lists.requested.some(
                        (entry: { user_id: string }) => entry.user_id === user.user.id
                      )
                    ? 'added'
                    : index === 1
                      ? 'added_you'
                      : 'none',
              })),
            },
          },
        });
      });
    }
    const discoveryRequests: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/v1/users/search' || path === '/api/v1/friends/recent')
        discoveryRequests.push(request.url());
    });
    await startSignedIn(page, account);
    await page.goto('/friends-add');
    const screen = page.getByTestId('friends-add-screen');
    const search = page.getByRole('textbox', { name: 'Find a player by name', exact: true });
    if (source === 'search') await search.fill(prefix);
    const names = screen.getByText(new RegExp(`^${prefix}[AB]$`));
    await expect(names).toHaveText([outgoingPlayer.name, incomingPlayer.name]);
    await page.clock.install();

    if (source === 'search') {
      const searched = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/users/search' &&
          new URL(response.url()).searchParams.get('q') === prefix.slice(0, -1)
      );
      await search.fill(prefix.slice(0, -1));
      await page.clock.runFor(350);
      expect((await searched).status()).toBe(200);
      await expect(names).toHaveText([outgoingPlayer.name, incomingPlayer.name]);
    }

    const beforeAdd = discoveryRequests.length;
    const added = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/friends/${outgoing.user.id}`) &&
        response.request().method() === 'PUT'
    );
    await screen.getByRole('button', { name: `Add ${outgoingPlayer.name}`, exact: true }).click();
    const addResponse = await added;
    expect(addResponse.status()).toBe(200);
    expect((await addResponse.json()).data.requested).toEqual(
      expect.arrayContaining([expect.objectContaining({ user_id: outgoing.user.id })])
    );
    await expect(screen.getByText('Sent', { exact: true })).toBeVisible();
    await expect(names).toHaveText([outgoingPlayer.name, incomingPlayer.name]);
    await page.clock.runFor(700);
    expect(discoveryRequests).toHaveLength(beforeAdd);

    // A different normalized query really fetches again (a trailing space does not).
    const searched = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/users/search' &&
        new URL(response.url()).searchParams.get('q') === prefix
    );
    await search.fill(prefix);
    await page.clock.runFor(350);
    expect((await searched).status()).toBe(200);
    if (source === 'recent') {
      const recent = page.waitForResponse('**/api/v1/friends/recent');
      await search.fill('');
      await page.clock.runFor(350);
      expect((await recent).status()).toBe(200);
    }
    await expect(names).toHaveText([outgoingPlayer.name, incomingPlayer.name]);
    await expect(screen.getByText('Sent', { exact: true })).toBeVisible();

    const beforeAccept = discoveryRequests.length;
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/friends/${incoming.user.id}`) &&
        response.request().method() === 'PUT'
    );
    await screen
      .getByRole('button', { name: `Accept ${incomingPlayer.name}`, exact: true })
      .click();
    const acceptResponse = await accepted;
    expect(acceptResponse.status()).toBe(200);
    expect((await acceptResponse.json()).data.friends).toEqual(
      expect.arrayContaining([expect.objectContaining({ user_id: incoming.user.id })])
    );
    await expect(screen.getByText('Friends', { exact: true })).toBeVisible();
    await expect(screen.getByText('Your friend', { exact: true })).toBeVisible();
    await expect(screen.getByText('Sent', { exact: true })).toBeVisible();
    await expect(names).toHaveText([outgoingPlayer.name, incomingPlayer.name]);
    await page.clock.runFor(700);
    expect(discoveryRequests).toHaveLength(beforeAccept);
    expect((await api('/api/v1/friends', { token: account.token })).payload.data).toMatchObject({
      friends: [expect.objectContaining({ user_id: incoming.user.id })],
      requested: [expect.objectContaining({ user_id: outgoing.user.id })],
    });
  });
}

test('empty Friends still shows recently played players and lets you add them', async ({
  page,
  player,
}) => {
  const account = await register(player);
  const recentPlayer = newPlayer();
  const recent = await register(recentPlayer);
  await page.route('**/api/v1/friends/recent', (route) =>
    route.fulfill({
      json: {
        data: {
          users: [
            {
              user_id: recent.user.id,
              display_name: recentPlayer.name,
              avatar_url: null,
              presence: 'offline',
              relation: 'none',
            },
          ],
        },
      },
    })
  );
  await startSignedIn(page, account);
  await page.goto('/friends');
  await expect(page.getByText(emptyFriends)).toBeVisible();
  await expect(page.getByText('Played with recently', { exact: true })).toBeVisible();
  await expect(page.getByText(recentPlayer.name, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Add ${recentPlayer.name}`, exact: true }).click();
  await expect(
    page.getByText(`Waiting for ${recentPlayer.name} to accept`, { exact: true })
  ).toBeVisible();
  expect((await api('/api/v1/friends', { token: account.token })).payload.data.requested).toEqual([
    expect.objectContaining({ user_id: recent.user.id }),
  ]);
});

test('Friends receives a live request, accepts, removes after confirmation, and searches @responsive', async ({
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
  const profile = page.getByTestId('player-profile-modal');
  await expect(profile).toBeVisible();
  await expect(profile.getByText(otherPlayer.name, { exact: true })).toBeVisible();
  await expect(profile.getByRole('button', { name: /^(Remove|Block)/ })).toHaveCount(0);
  await profile.getByRole('button', { name: 'Close', exact: true }).click();
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

test('ignoring hides a request immediately, Undo restores it, and only sender cancellation removes the edge @responsive', async ({
  page,
  player,
  browser,
}) => {
  const receiver = await register(player);
  const senderPlayer = newPlayer();
  const sender = await register(senderPlayer);
  expect(
    (await api(`/api/v1/friends/${receiver.user.id}`, { method: 'PUT', token: sender.token }))
      .status
  ).toBe(200);
  await startSignedIn(page, receiver);
  await page.goto('/friends');
  const accept = page.getByRole('button', { name: `Accept ${senderPlayer.name}`, exact: true });
  const ignore = page.getByRole('button', {
    name: `Ignore ${senderPlayer.name}’s request`,
    exact: true,
  });
  await expect(accept).toBeVisible();

  // Hold the real response: the row must disappear before the server replies.
  let releaseIgnore!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseIgnore = resolve;
  });
  await page.route(
    `**/api/v1/friends/${sender.user.id}/ignore`,
    async (route) => {
      const response = await route.fetch();
      await released;
      await route.fulfill({ response });
    },
    { times: 1 }
  );
  const ignored = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/friends/${sender.user.id}/ignore`) &&
      response.request().method() === 'POST'
  );
  try {
    await ignore.click();
    await expect(accept).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: `View ${senderPlayer.name}’s profile`, exact: true })
    ).toHaveCount(0);
  } finally {
    releaseIgnore();
  }
  expect((await ignored).status()).toBe(200);
  expect((await api('/api/v1/friends', { token: receiver.token })).payload.data.added_you).toEqual(
    []
  );
  expect(
    (await api('/api/v1/friends', { token: sender.token })).payload.data.requested.map(
      (entry: { user_id: string }) => entry.user_id
    )
  ).toEqual([receiver.user.id]);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(accept).toBeVisible();
  await expect
    .poll(async () =>
      (await api('/api/v1/friends', { token: receiver.token })).payload.data.added_you.map(
        (entry: { user_id: string }) => entry.user_id
      )
    )
    .toEqual([sender.user.id]);
  await page.reload();
  await expect(accept).toBeVisible();
  await ignore.click();
  await expect(accept).toHaveCount(0);
  await expect
    .poll(
      async () => (await api('/api/v1/friends', { token: receiver.token })).payload.data.added_you
    )
    .toEqual([]);

  const context = await browser.newContext({
    viewport: page.viewportSize()!,
    baseURL: test.info().project.use.baseURL,
  });
  try {
    const sentPage = await context.newPage();
    await sentPage.addInitScript((age) => {
      localStorage.setItem('age-gate-storage', age);
      localStorage.setItem('news-seen:welcome', '1');
    }, AGE_ANSWERED);
    await startSignedIn(sentPage, sender);
    await sentPage.goto('/friends');
    await expect(sentPage.getByText('Waiting for an answer', { exact: true })).toBeVisible();
    const cancel = sentPage.getByRole('button', {
      name: `Cancel your friend request to ${player.name}`,
      exact: true,
    });
    await expect(cancel).toBeVisible();
    expect(
      (await api('/api/v1/friends', { token: sender.token })).payload.data.requested.map(
        (entry: { user_id: string }) => entry.user_id
      )
    ).toEqual([receiver.user.id]);
    await cancel.click();
    await expect(cancel).toHaveCount(0);
    await expect
      .poll(
        async () => (await api('/api/v1/friends', { token: sender.token })).payload.data.requested
      )
      .toEqual([]);
    await sentPage.reload();
    await expect(sentPage.getByText(emptyFriends)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('Join seats the player at a real friend table and opens its game', async ({
  page,
  player,
  browser,
}) => {
  const account = await register(player);
  const hostPlayer = newPlayer();
  const host = await register(hostPlayer);
  for (const [caller, target] of [
    [account, host],
    [host, account],
  ]) {
    expect(
      (await api(`/api/v1/friends/${target.user.id}`, { method: 'PUT', token: caller.token }))
        .status
    ).toBe(200);
  }
  const created = await api('/api/v1/rooms', {
    method: 'POST',
    token: host.token,
    body: { seats: { seat_2: 'open', seat_3: 'open', seat_4: 'ai' } },
  });
  expect(created.status).toBe(201);
  const code = created.payload.data.code;
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    // Waiting tables need a connected host to advertise their live presence.
    const hostPage = await context.newPage();
    await hostPage.addInitScript((age) => {
      localStorage.setItem('age-gate-storage', age);
      localStorage.setItem('news-seen:welcome', '1');
    }, AGE_ANSWERED);
    await startSignedIn(hostPage, host);
    await hostPage.goto(`/game/${code}`);
    await expect(hostPage.getByTestId('waiting-table').last()).toBeVisible({ timeout: 30_000 });
    await startSignedIn(page, account);
    await page.goto('/friends');
    await page.getByRole('button', { name: `View ${hostPlayer.name}’s profile` }).click();
    const join = page
      .getByTestId('friend-sheet')
      .getByRole('button', { name: `Join ${hostPlayer.name}’s table`, exact: true });
    await join.waitFor();
    // A stale seat offer must explain the refusal and fetch a fresh list.
    await page.route(`**/api/v1/friends/${host.user.id}/join`, (route) =>
      route.fulfill({
        status: 409,
        json: { error_code: 'no_seat_for_you', error: 'NO_SEAT_FOR_YOU' },
      })
    );
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/friends' &&
        response.request().method() === 'GET'
    );
    await join.click();
    await expect(
      page.getByText('There is no seat available for you at this table.', { exact: true })
    ).toBeVisible();
    expect((await refreshed).status()).toBe(200);
    await page.unroute(`**/api/v1/friends/${host.user.id}/join`);
    await expect(join).toBeEnabled();
    const joined = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/friends/${host.user.id}/join`) &&
        response.request().method() === 'POST'
    );
    await join.click();
    const response = await joined;
    expect(response.status()).toBe(200);
    expect((await response.json()).data).toMatchObject({
      room: { code },
      assigned_position: 'south',
    });
    await page.waitForURL(`**/game/${code}`);
    await expect(page.getByTestId('waiting-table').last()).toBeVisible({ timeout: 30_000 });
    const room = await api(`/api/v1/rooms/${code}`, { token: account.token });
    expect(room.status).toBe(200);
    expect(room.payload.data.room.positions.south).toBe(account.user.id);
  } finally {
    await context.close();
  }
});

test('Play opens New table with the friend already assigned as Partner and creates a held south seat', async ({
  page,
  player,
  browser,
}) => {
  const account = await register(player);
  const friendPlayer = newPlayer();
  const friend = await register(friendPlayer);
  for (const [caller, target] of [
    [account, friend],
    [friend, account],
  ]) {
    expect(
      (await api(`/api/v1/friends/${target.user.id}`, { method: 'PUT', token: caller.token }))
        .status
    ).toBe(200);
  }
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const friendPage = await context.newPage();
    await friendPage.addInitScript((age) => {
      localStorage.setItem('age-gate-storage', age);
      localStorage.setItem('news-seen:welcome', '1');
    }, AGE_ANSWERED);
    await startSignedIn(friendPage, friend);
    await friendPage.goto('/friends');
    await expect
      .poll(
        async () =>
          (await api('/api/v1/friends', { token: account.token })).payload.data.friends[0]?.presence
      )
      .toBe('online');
    await startSignedIn(page, account);
    await page.route('**/api/v1/friends', (route) =>
      route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } })
    );
    const unavailable = page.waitForResponse('**/api/v1/friends');
    await page.goto(`/new-table?partner=${friend.user.id}`);
    expect((await unavailable).status()).toBe(503);
    // A failed cold lookup keeps the intent while the setup remains usable.
    await expect(page.getByTestId('new-table-screen')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/new-table\\?partner=${friend.user.id}$`));
    await page.unroute('**/api/v1/friends');
    await page.reload();
    await expect(
      page.getByTestId('new-table-seat-south').getByText(friendPlayer.name, { exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel creation', exact: true }).click();
    // Warm a known current table, then enter through Friends instead of New table.
    await page.route('**/api/v1/lobby', (route) =>
      route.fulfill({
        status: 200,
        json: {
          data: {
            my_rejoinable: [{ code: 'MINE01', name: 'My table', status: 'playing', seats: [] }],
            open_tables: [],
            substitute_needed: [],
            spectatable: [],
          },
        },
      })
    );
    await page.goto('/home');
    await page.getByTestId('home-play-online').click();
    await expect(page.getByText('Your table', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Go back', exact: true }).click();
    await page.getByRole('button', { name: 'Friends', exact: true }).click();
    await page
      .getByRole('button', { name: `Start a table with ${friendPlayer.name}`, exact: true })
      .click();
    await page.waitForURL('**/lobby');
    await expect(page.getByRole('button', { name: 'Rejoin', exact: true })).toBeVisible();
    await expect(page.getByTestId('new-table-screen')).toBeHidden();
    await page.unroute('**/api/v1/lobby');
    await page.goto('/friends');
    await page.getByRole('button', { name: `View ${friendPlayer.name}’s profile` }).click();
    await page
      .getByTestId('friend-sheet')
      .getByRole('button', { name: 'Play together', exact: true })
      .click();
    await page.waitForURL(new RegExp(`/new-table\\?partner=${friend.user.id}$`));
    const form = page.getByTestId('new-table-screen');
    await expect(form).toBeVisible();
    const partner = form.getByTestId('new-table-seat-south');
    await expect(partner.getByText(friendPlayer.name, { exact: true })).toBeVisible();
    await expect(
      partner.getByText('Invited when you open the table', { exact: true })
    ).toBeVisible();
    await expect(page.getByTestId('seat-picker-container')).toBeHidden();
    const created = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/rooms' &&
        response.request().method() === 'POST'
    );
    await form.getByRole('button', { name: 'Open the table', exact: true }).click();
    const response = await created;
    expect(response.request().postDataJSON().seats.seat_3).toEqual({
      type: 'held',
      user_id: friend.user.id,
    });
    expect(response.status()).toBe(201);
    await page.waitForURL(/\/game\/[A-Z0-9]+$/);
    const code = new URL(page.url()).pathname.split('/').pop();
    const room = await api(`/api/v1/rooms/${code}`, { token: account.token });
    expect(room.status).toBe(200);
    expect(room.payload.data.room.positions.south).toBeNull();
    expect(room.payload.data.room.seats.south.held_for.user_id).toBe(friend.user.id);
  } finally {
    await context.close();
  }
});

test('a guest opens Friends from Home, saves, and stays on Friends', async ({ page, player }) => {
  const started = await guest(player);
  await startSignedIn(page, started);
  await page.goto('/home');
  await page.getByRole('button', { name: 'Friends', exact: true }).click();
  const sheet = new AuthSheet(page);
  await expect(sheet.root).toBeVisible();
  await sheet.save(player.email, player.password, player.name);
  await expect(sheet.root).toBeHidden();
  await expect(page.getByTestId('friends-screen')).toBeVisible();
  await expect(page.getByText(emptyFriends)).toBeVisible();
  expect((await sessionOf(page))?.user).toMatchObject({ id: started.user.id, guest: false });
});
