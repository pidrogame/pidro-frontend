import { test, expect } from '../fixtures';
import { HomeScreen } from '../screens/home-screen';
import { LoginScreen } from '../screens/login-screen';
import { api, register } from '../support/api';
import { newPlayer } from '../support/player';
import { startSignedIn } from '../support/session';

test('a player joins a specific open chair from Tables with one tap @responsive', async ({
  page,
  player,
  browser,
  baseURL,
}) => {
  const host = await register(newPlayer());
  const created = await api('/api/v1/rooms', {
    method: 'POST',
    token: host.token,
    body: { name: 'One-tap waiting table' },
  });
  expect(created.status).toBe(201);
  const code = created.payload.data.code;
  const account = await register(player);

  // Waiting tables need a connected human to be listed in the real lobby.
  const hostContext = await browser.newContext({ baseURL });
  try {
    const hostPage = await hostContext.newPage();
    await hostPage.addInitScript(() => {
      localStorage.setItem(
        'age-gate-storage',
        JSON.stringify({ state: { ageBand: '18_plus', termsVersion: '1' }, version: 0 })
      );
      localStorage.setItem('news-seen:welcome', '1');
    });
    await startSignedIn(hostPage, host);
    await hostPage.goto(`/game/${code}`);
    await expect(hostPage.getByTestId('waiting-table').last()).toBeVisible({ timeout: 30_000 });

    await page.goto('/login');
    await new LoginScreen(page).signIn(player.email, player.password);
    const home = new HomeScreen(page);
    await expect(home.root).toBeVisible();
    await home.playOnline.click();
    await expect(page.getByTestId('lobby-screen')).toBeVisible();
    const row = page.getByTestId(`lobby-table-${code}`);
    const joined = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v1/rooms/${code}/join` &&
        response.request().method() === 'POST'
    );
    await row.getByRole('button', { name: 'Join west seat', exact: true }).click();
    const response = await joined;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toEqual({ position: 'west' });
    expect((await response.json()).data.assigned_position).toBe('west');
    await page.waitForURL(`**/game/${code}`);
    await expect(page.getByTestId('waiting-table').last()).toBeVisible({ timeout: 30_000 });
    const server = await api(`/api/v1/rooms/${code}`, { token: account.token });
    expect(server.status).toBe(200);
    expect(server.payload.data.room.positions.west).toBe(account.user.id);
  } finally {
    await hostContext.close();
  }
});

test('a 1000+ chair explains the local lock and the server refusal @responsive', async ({
  page,
  player,
  browser,
  baseURL,
}) => {
  const host = await register(newPlayer());
  const account = await register(player);
  const hostContext = await browser.newContext({ baseURL });
  try {
    const hostPage = await hostContext.newPage();
    await hostPage.addInitScript(() => {
      localStorage.setItem(
        'age-gate-storage',
        JSON.stringify({
          state: { ageBand: '18_plus', termsVersion: '1' },
          version: 0,
        })
      );
      localStorage.setItem('news-seen:welcome', '1');
    });
    await startSignedIn(hostPage, host);
    await hostPage.goto('/lobby');
    await hostPage.getByRole('button', { name: 'Start a table', exact: true }).first().click();
    await expect(hostPage).toHaveURL(/\/new-table$/);
    const form = hostPage.getByTestId('new-table-screen');
    const partner = form.getByTestId('new-table-seat-south');
    await expect(partner).toHaveAccessibleName('Partner: Open seat, Anyone can sit. Change');
    await partner.click();
    await hostPage
      .getByTestId('seat-picker-container')
      .getByRole('radio', { name: /^1000\+ games played,/ })
      .click();
    await expect(hostPage.getByTestId('seat-picker-container')).toBeHidden();
    const created = hostPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/rooms' &&
        response.request().method() === 'POST'
    );
    await form.getByRole('button', { name: 'Open the table', exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON().seats.seat_3).toEqual({
      type: 'open',
      min_games: 1000,
    });
    const code = (await response.json()).data.code;
    await expect(hostPage.getByTestId('waiting-table').last()).toBeVisible({ timeout: 30_000 });

    await startSignedIn(page, account);
    let joins = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === `/api/v1/rooms/${code}/join`) joins += 1;
    });
    await page.goto('/lobby');
    const row = page.getByTestId(`lobby-table-${code}`);
    const reason = '1,000 games played needed, you have 0';
    const chair = row.getByRole('button', {
      name: `south seat locked, ${reason}`,
      exact: true,
    });
    await expect(chair).toBeVisible();
    await expect(row.getByTestId('seat-requirement')).toHaveText('1,000+');
    await chair.click();
    await expect(row.getByRole('alert')).toHaveText(reason);
    expect(joins).toBe(0);
    await expect(row.getByRole('alert')).toHaveCount(0, { timeout: 7000 });

    // A profile without the optional count must leave admission to the real server.
    await page.route('**/api/v1/profile', async (route) => {
      const profileResponse = await route.fetch();
      const body = await profileResponse.json();
      delete body.data.record;
      await route.fulfill({ response: profileResponse, json: body });
    });
    await page.reload();
    const unlocked = row.getByRole('button', {
      name: 'Join south seat, 1,000 games played needed',
      exact: true,
    });
    await expect(unlocked).toBeVisible();
    const refused = page.waitForResponse(
      (reply) => new URL(reply.url()).pathname === `/api/v1/rooms/${code}/join`
    );
    await unlocked.click();
    const refusal = await refused;
    expect(refusal.status()).toBe(403);
    expect(await refusal.json()).toMatchObject({
      error: 'SEAT_REQUIRES_GAMES',
      min_games: 1000,
      games_played: 0,
    });
    await expect(row.getByRole('alert')).toHaveText(reason);
    expect(joins).toBe(1);
    expect(
      (await api(`/api/v1/rooms/${code}`, { token: account.token })).payload.data.room.positions
        .south
    ).toBeNull();
  } finally {
    await hostContext.close();
  }
});

test('Watch shows the hand and score of a playing table', async ({
  page,
  player,
  browser,
  baseURL,
}) => {
  const host = await register(newPlayer());
  const partner = await register(newPlayer());
  const watcher = await register(player);
  const created = await api('/api/v1/rooms', {
    method: 'POST',
    token: host.token,
    body: { seats: { seat_2: 'ai', seat_3: 'open', seat_4: 'ai' } },
  });
  expect(created.status).toBe(201);
  const code = created.payload.data.code;
  expect(
    (
      await api(`/api/v1/rooms/${code}/join`, {
        method: 'POST',
        token: partner.token,
        body: { position: 'south' },
      })
    ).status
  ).toBe(200);
  const hostContext = await browser.newContext({ baseURL });
  const partnerContext = await browser.newContext({ baseURL });
  try {
    // All-bot opponents make a private solo table, so keep two real players seated.
    const seated = [];
    for (const [context, session] of [
      [hostContext, host],
      [partnerContext, partner],
    ] as const) {
      const seatPage = await context.newPage();
      await seatPage.addInitScript(() => {
        localStorage.setItem(
          'age-gate-storage',
          JSON.stringify({
            state: { ageBand: '18_plus', termsVersion: '1' },
            version: 0,
          })
        );
        localStorage.setItem('news-seen:welcome', '1');
      });
      await startSignedIn(seatPage, session);
      await seatPage.goto(`/game/${code}`);
      await expect(seatPage.getByRole('button', { name: "I'm ready", exact: true })).toBeEnabled();
      seated.push(seatPage);
    }
    await startSignedIn(page, watcher);
    await page.goto('/lobby');
    await expect(page.getByTestId('lobby-screen')).toBeVisible();
    await Promise.all(
      seated.map((seatPage) =>
        seatPage.getByRole('button', { name: "I'm ready", exact: true }).click()
      )
    );
    const row = page.getByTestId(`lobby-table-${code}`);
    await expect(row.getByRole('button', { name: 'Watch', exact: true })).toBeVisible();
    await expect(row.getByText(/^Hand \d+ · -?\d+ to -?\d+$/)).toBeVisible();
  } finally {
    await hostContext.close();
    await partnerContext.close();
  }
});
