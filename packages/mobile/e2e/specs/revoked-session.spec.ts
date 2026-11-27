import { test, expect } from '../fixtures';
import { WelcomeWindow } from '../screens/welcome-window';
import { deleteAccount, register } from '../support/api';
import { sessionOf, startSignedIn } from '../support/session';

test('a session the server no longer accepts lands on Welcome, not a broken Home', async ({
  page,
  player,
}) => {
  const account = await register(player);
  await startSignedIn(page, account);
  await deleteAccount(account.token);

  await page.goto('/home');
  await expect(new WelcomeWindow(page).root).toBeVisible({ timeout: 30_000 });
  expect((await sessionOf(page))?.accessToken ?? null).toBeNull();
});
