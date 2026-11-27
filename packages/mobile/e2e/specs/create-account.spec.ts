import { test, expect } from '../fixtures';
import { HomeScreen } from '../screens/home-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { RegisterScreen } from '../screens/register-screen';
import { WelcomeWindow } from '../screens/welcome-window';
import { sessionOf } from '../support/session';

test('a new player creates an account, stays signed in, and signs out', async ({
  page,
  player,
}) => {
  const register = new RegisterScreen(page);
  await page.goto('/');
  await new WelcomeWindow(page).createAccount.click({ timeout: 30_000 });
  await expect(register.root).toBeVisible();

  // Bad input is caught before anything is sent.
  let sent = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/auth/register')) sent += 1;
  });
  await register.enterEmail('not-an-email');
  await expect(register.text('Check that email address.')).toBeVisible();
  await register.enterEmail(player.email);
  await register.enterPassword('short');
  await expect(register.text('Use 8 characters or more.')).toBeVisible();

  await register.enterPassword(player.password);
  await register.enterName('  ');
  await expect(register.text('Enter the name other players will see.')).toBeVisible();
  expect(sent).toBe(0);
  await register.enterName(player.name);
  await expect(new HomeScreen(page).root).toBeVisible();
  await page.waitForURL(/\/home$/);

  await page.reload();
  await expect(new HomeScreen(page).root).toBeVisible();
  const session = await sessionOf(page);
  expect(session?.accessToken).toBeTruthy();
  expect(session?.user?.guest).toBeFalsy();

  await page.goto('/profile');
  const profile = new ProfileScreen(page);
  await expect(profile.root).toBeVisible();
  await profile.signOut();
  await page.waitForURL(/\/welcome$/);
});
