import { test, expect } from '../fixtures';
import { HomeScreen } from '../screens/home-screen';
import { LoginScreen } from '../screens/login-screen';
import { api, register } from '../support/api';
import { newPlayer } from '../support/player';
import { startSignedIn } from '../support/session';

test('a player joins a specific open chair from Tables with one tap', async ({
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
