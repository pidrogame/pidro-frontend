import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { ForgotPasswordScreen } from '../screens/forgot-password-screen';
import { LoginScreen } from '../screens/login-screen';
import { RegisterScreen } from '../screens/register-screen';
import type { Screen } from '../screens/screen';
import { register } from '../support/api';

/** The form answered the dropped request in plain words, is usable again, and kept what was typed. */
async function expectRecoverable(screen: Screen, submit: Locator, typed: [Locator, string][]) {
  await expect(screen.alert).toBeVisible();
  await expect(screen.alert).not.toContainText(/network error|axios|undefined|\[object/i);
  await expect(submit).toBeEnabled();
  for (const [field, value] of typed) await expect(field).toHaveValue(value);
}

test('a dropped connection on each form is readable, leaves no spinner and keeps the input', async ({
  page,
  player,
}) => {
  await register(player);
  const drop = (path: string) =>
    page.route(`**/api/v1/${path}`, (route) => route.abort('connectionreset'));

  await test.step('sign in', async () => {
    await drop('auth/login');
    await page.goto('/login');
    const screen = new LoginScreen(page);
    await screen.identifier.fill(player.email);
    await screen.field('Password').fill(player.password);
    await screen.button('Sign in').click();
    await expect(screen.alert).toHaveText('Could not sign in. Try again.');
    await expectRecoverable(screen, screen.button('Sign in'), [
      [screen.identifier, player.email],
      [screen.field('Password'), player.password],
    ]);
    await page.unroute('**/api/v1/auth/login');
  });

  await test.step('create account', async () => {
    await drop('auth/register');
    await page.goto('/register');
    const screen = new RegisterScreen(page);
    await screen.enterEmail(`new_${player.email}`);
    await screen.enterPassword(player.password);
    await screen.field('Public name').fill(`New${player.id}`);
    await screen.button('CONTINUE').click();
    await expect(screen.alert).toHaveText('Could not save your account. Try again.');
    await expectRecoverable(screen, screen.button('CONTINUE'), [
      [screen.field('Public name'), `New${player.id}`],
    ]);
    await page.unroute('**/api/v1/auth/register');
  });

  await test.step('forgot password', async () => {
    await drop('auth/password-reset');
    await page.goto('/forgot-password');
    const screen = new ForgotPasswordScreen(page);
    await screen.identifier.fill(player.email);
    await screen.button('Email me a link').click();
    await expectRecoverable(screen, screen.button('Email me a link'), [
      [screen.identifier, player.email],
    ]);
    await page.unroute('**/api/v1/auth/password-reset');
  });

  await test.step('claim Classic', async () => {
    await drop('classic/verify');
    await page.goto('/claim-classic');
    const screen = new ClaimClassicScreen(page);
    await screen.text('How did you sign in to Classic?').waitFor();
    await screen.button('Username and password').click();
    await screen.field('Username or email').fill(player.classicLogin);
    await screen.field('Password').fill(player.classicPassword);
    await screen.button('Find my account').click();
    await expectRecoverable(screen, screen.button('Find my account'), [
      [screen.field('Username or email'), player.classicLogin],
    ]);
    await page.unroute('**/api/v1/classic/verify');
  });
});
