import { test, expect } from '../fixtures';
import { HomeScreen } from '../screens/home-screen';
import { LoginScreen } from '../screens/login-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { register } from '../support/api';

test('a player signs in with a wrong password, then with email, then with their name @responsive', async ({
  page,
  player,
}) => {
  await register(player);
  const login = new LoginScreen(page);
  await page.goto('/login');

  await login.signIn(player.email, 'wrong-password');
  await expect(login.text('That name and password don’t match.')).toBeVisible();

  await login.signIn(player.email, player.password);
  await expect(new HomeScreen(page).root).toBeVisible();

  await page.goto('/profile');
  await new ProfileScreen(page).signOut();
  await page.waitForURL(/\/welcome$/);

  await page.goto('/login');
  await new LoginScreen(page).signIn(player.name, player.password);
  await expect(new HomeScreen(page).root).toBeVisible();
});
