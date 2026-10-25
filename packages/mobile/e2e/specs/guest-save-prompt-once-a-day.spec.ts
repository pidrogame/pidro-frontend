import { test, expect } from '../fixtures';
import { HomeScreen } from '../screens/home-screen';
import { guest } from '../support/api';
import { playOutGame, tableCode } from '../support/game';
import { startSignedIn } from '../support/session';

test.setTimeout(150_000);

test('the save prompt after a finished game shows once that day', async ({ page, player }) => {
  const started = await guest(player);
  await startSignedIn(page, started);
  await page.goto('/home');

  await page.getByTestId('home-quick-game').click();
  await page.waitForURL(/\/game\/[A-Z0-9]+/);
  const first = await playOutGame(page, started.token);
  await expect(first.getByTestId('guest-save')).toBeVisible();
  // Force the order that races, with the server's own answers: the new table is
  // refused while the leave from the game-over window is held back, that leave
  // lands next, and Home's own leave then finds nothing to leave.
  const finished = tableCode(page);
  const refused = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/api/v1/rooms')
  );
  const left = page.waitForResponse((response) => response.url().endsWith(`/${finished}/leave`));
  await page.route(`**/api/v1/rooms/${finished}/leave`, async (route) => {
    await refused;
    await route.continue();
  });
  await page.route('**/api/v1/rooms/current/leave', async (route) => {
    await left;
    await route.continue();
  });
  await page.getByTestId('game-over-home').click();
  await expect(new HomeScreen(page).root).toBeVisible();

  await page.getByTestId('home-quick-game').click();
  expect((await refused).status()).toBe(422);
  await page.waitForURL(/\/game\/[A-Z0-9]+/);
  const second = await playOutGame(page, started.token);
  // The result is complete once the XP shows; the prompt would have come with it.
  await expect(second.getByText(/\+\d+ XP/)).toBeVisible();
  await expect(second.getByTestId('guest-save')).toHaveCount(0);
});
