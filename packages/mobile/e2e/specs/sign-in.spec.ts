import { test, expect } from '../fixtures';
import { HomeScreen } from '../screens/home-screen';
import { LoginScreen } from '../screens/login-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { WelcomeWindow } from '../screens/welcome-window';
import { register } from '../support/api';

test('a player signs in from the first screen, and after signing out continues as themselves @responsive', async ({
  page,
  player,
}) => {
  await register(player);
  const welcome = new WelcomeWindow(page);
  const login = new LoginScreen(page);
  await page.goto('/');
  await welcome.haveAccount.click({ timeout: 30_000 });

  await login.signIn(player.email, 'wrong-password');
  await expect(login.text('That name and password don’t match.')).toBeVisible();

  await login.signIn(player.email, player.password);
  await expect(new HomeScreen(page).root).toBeVisible();

  await page.goto('/profile');
  await new ProfileScreen(page).signOut();
  await page.waitForURL(/\/welcome$/);

  // The phone remembers them (PID-512): one door with their name, and Sign in asks only the password.
  await expect(welcome.haveAccount).toHaveAccessibleName(`Continue as ${player.name}`);
  await welcome.haveAccount.click();
  await expect(login.identifier).toHaveValue(player.name);
  await expect(login.field('Password')).toBeFocused();
  await login.field('Password').fill(player.password);
  await login.button('Sign in').click();
  await expect(new HomeScreen(page).root).toBeVisible();
});
