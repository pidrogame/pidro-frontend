import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { WelcomeWindow } from '../screens/welcome-window';
import { profile } from '../support/api';
import { sessionOf } from '../support/session';

test('a Classic account with no username claims by its email and shows the first name', async ({
  page,
  player,
}) => {
  await page.goto('/');
  await new WelcomeWindow(page).classicPlaque.click({ timeout: 30_000 });
  const claim = new ClaimClassicScreen(page);
  await claim.verify(`nameless-${player.id}@classic.example`, player.classicPassword);
  await expect(claim.found).toBeVisible();
  await expect(claim.text('Gertrude')).toBeVisible();

  await claim.confirmIdentity();
  await claim.createAccountAndClaim({
    username: player.name,
    email: player.email,
    password: player.password,
  });
  await page.waitForURL(/\/profile/);
  const screen = new ProfileScreen(page);
  await expect(await screen.openBadges()).toContainText(/as Gertrude/);
  const token = (await sessionOf(page))?.accessToken as string;
  expect((await profile(token)).classic).toMatchObject({ name: 'Gertrude' });
});

test('refused Classic login values become editable without losing the new password @responsive', async ({
  page,
  player,
}) => {
  let attempts = 0;
  await page.route('**/api/v1/classic/claim', async (route) => {
    attempts += 1;
    if (attempts < 3) {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          errors: [{ code: attempts === 1 ? 'USERNAME_TAKEN' : 'EMAIL_TAKEN' }],
        }),
      });
    } else await route.continue();
  });
  await page.goto('/claim-classic');
  const claim = new ClaimClassicScreen(page);
  await claim.verify(player.classicLogin, player.classicPassword);
  await claim.confirmIdentity();
  await claim.field('New password').fill(player.password);
  await claim.button('Save and play').click();
  await expect(claim.field('Username')).toBeVisible();
  await expect(claim.found).toBeHidden();
  await claim.field('Username').fill(player.name);
  await claim.button('Save and play').click();
  await expect(claim.field('Email')).toBeVisible();
  await expect(claim.field('Username')).toHaveValue(player.name);
  await expect(claim.field('New password')).toHaveValue(player.password);
  await claim.field('Email').fill(player.email);
  const submitted = page.waitForRequest('**/api/v1/classic/claim');
  await claim.button('Save and play').click();
  expect((await submitted).postDataJSON().account).toEqual({
    username: player.name,
    email: player.email,
    password: player.password,
  });
  await page.waitForURL(/\/profile/);
  expect(attempts).toBe(3);
  // Refusals above are simulated; the real ticket still owns its offered login.
  expect((await sessionOf(page))?.user).toMatchObject({
    username: player.classicLogin,
    email: `${player.classicLogin}@classic.example`,
    guest: false,
  });
});
