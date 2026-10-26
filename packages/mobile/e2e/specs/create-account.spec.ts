import { test, expect } from '../fixtures';
import { HomeScreen } from '../screens/home-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { RegisterScreen } from '../screens/register-screen';
import { WelcomeWindow } from '../screens/welcome-window';
import { register as registerViaApi } from '../support/api';
import { tableCode } from '../support/game';
import { AGE_ANSWERED, newPlayer } from '../support/player';
import { sessionOf, startSignedIn } from '../support/session';

test('a new player creates an account, stays signed in, and signs out @responsive', async ({
  page,
  player,
}) => {
  const register = new RegisterScreen(page);
  await page.goto('/');
  await new WelcomeWindow(page).playOnline.click({ timeout: 30_000 });
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

test('a new account opens an Ostrobothnian table that another player can find with two open chairs @responsive', async ({
  page,
  player,
  browser,
}) => {
  await page.goto('/register');
  await new RegisterScreen(page).createAccount(player);
  await expect(new HomeScreen(page).root).toBeVisible();
  await page.goto('/lobby');
  await page.getByRole('button', { name: 'Start a table', exact: true }).first().click();
  await expect(page).toHaveURL(/\/new-table$/);
  const form = page.getByTestId('new-table-screen');
  await expect(
    form
      .getByRole('radiogroup', { name: 'Rules', exact: true })
      .getByRole('radio', { name: 'Ostrobothnian', exact: true })
  ).toHaveAttribute('aria-checked', 'true');
  await expect(form.getByTestId('new-table-seat-north')).toHaveText('YouHost');
  await expect(form.getByTestId('new-table-seat-south')).toHaveAccessibleName(
    'Partner: Open seat, Anyone can sit. Change'
  );
  for (const position of ['south', 'east', 'west']) {
    await form.getByTestId(`new-table-seat-${position}`).click();
    const picker = page.getByTestId('seat-picker-container');
    await expect(picker.getByRole('radio', { name: /^Anyone,/ })).toBeChecked();
    await picker.getByRole('radio', { name: position === 'west' ? /^Bot,/ : /^Anyone,/ }).click();
    await expect(picker).toBeHidden();
  }
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/rooms' && response.request().method() === 'POST'
  );
  await form.getByRole('button', { name: 'Open the table', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toEqual({
    rule_set: 'finnish',
    seats: { seat_2: 'open', seat_3: 'open', seat_4: 'ai' },
  });
  await page.waitForURL(/\/game\/[A-Z0-9]+$/);
  const code = tableCode(page);
  await expect(page.getByTestId('waiting-table').last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('waiting-rule-set').last()).toContainText('Ostrobothnian');

  // A separate context has neither the host's auth nor its cached lobby data.
  // Keep the host connected so the server lists this waiting table.
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const visitor = await context.newPage();
    await visitor.addInitScript((age) => {
      localStorage.setItem('age-gate-storage', age);
      localStorage.setItem('news-seen:welcome', '1');
    }, AGE_ANSWERED);
    await startSignedIn(visitor, await registerViaApi(newPlayer()));
    await visitor.goto('/lobby');
    const table = visitor.getByTestId(`lobby-table-${code}`);
    await expect(table).toBeVisible({ timeout: 30_000 });
    await expect(table.getByTestId(`room-rules-${code}`)).toContainText('Ostrobothnian');
    await expect(table.getByText(player.name, { exact: true })).toBeVisible();
    const chairs = table.getByRole('button', { name: /^Join .* seat$/ });
    await expect(chairs).toHaveCount(2);
    await expect(chairs.nth(0)).toBeEnabled();
    await expect(chairs.nth(1)).toBeEnabled();
  } finally {
    await context.close();
  }
});
