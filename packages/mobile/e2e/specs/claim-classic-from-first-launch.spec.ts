import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { WelcomeWindow } from '../screens/welcome-window';
import { profile, whoAmI } from '../support/api';
import { sessionOf } from '../support/session';

test('a Classic player claims their account from the first launch @responsive', async ({
  page,
  player,
}) => {
  let claims = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/classic/claim')) claims += 1;
  });
  await page.goto('/');
  await new WelcomeWindow(page).classicPlaque.click({ timeout: 30_000 });
  const claim = new ClaimClassicScreen(page);
  await expect(claim.root).toBeVisible();

  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.found).toBeVisible();
  await expect(claim.root.locator('input')).toHaveCount(0);
  await expect(claim.button('Save and play')).toHaveCount(0);
  expect(claims).toBe(0);
  await claim.confirmIdentity();
  await expect(claim.field('New password')).toBeVisible();
  await expect(claim.text('The new Pidro needs its own password.')).toBeVisible();
  await expect(claim.text('At least 8 letters or numbers.')).toBeVisible();
  expect(claims).toBe(0);

  // Classic supplies the login without exposing a kept email or an editable name.
  const offered = await claim.newAccount();
  if (offered?.username) {
    await expect(claim.text(`Your name stays ${offered.username}.`)).toBeVisible();
    await expect(claim.field('Username')).toHaveCount(0);
  }
  if (offered?.email) {
    await expect(claim.kept('Email', offered.email)).toHaveCount(0);
    await expect(claim.root).not.toContainText(offered.email);
    await expect(claim.field('Email')).toHaveCount(0);
  }

  // Confirming without account details is caught before sending.
  await claim.button('Save and play').click();
  await expect(
    claim.text(offered?.username ? 'Use 8 characters or more.' : 'Use at least 3 characters.')
  ).toBeVisible();
  expect(claims).toBe(0);

  const { email } = await claim.createAccountAndClaim({
    username: player.name,
    email: player.email,
    password: player.password,
  });
  await page.waitForURL(/\/profile/);
  await expect(new ProfileScreen(page).classicChip).toBeVisible();

  const session = await sessionOf(page);
  expect(session?.user).toMatchObject({ guest: false, email });
  const token = session?.accessToken as string;
  expect(await whoAmI(token)).toMatchObject({ guest: false, email });
  expect((await profile(token)).classic).toMatchObject({ name: player.classicLogin, level: 42 });
});

test('a Classic preview can be rejected without creating an account @responsive', async ({
  page,
  player,
}) => {
  let claims = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/classic/claim')) claims += 1;
  });
  await page.goto('/claim-classic');
  const claim = new ClaimClassicScreen(page);
  await expect(claim.text('How did you sign in to Classic?')).toBeVisible();
  await expect(claim.root.locator('input')).toHaveCount(0);
  await expect(claim.text("Don't remember? Get help")).toBeVisible();

  await claim.button('Username and password').click();
  await expect(claim.text('Your Classic sign-in')).toBeVisible();
  await claim.text('Used Apple or Facebook instead?').click();
  await expect(claim.text('How did you sign in to Classic?')).toBeVisible();
  await expect(claim.root.locator('input')).toHaveCount(0);

  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.found).toBeVisible();
  await expect(claim.root.locator('input')).toHaveCount(0);
  await claim.text('No, go back').click();
  await expect(claim.text('How did you sign in to Classic?')).toBeVisible();
  await expect(claim.found).toBeHidden();
  await expect(claim.root.locator('input')).toHaveCount(0);
  expect(claims).toBe(0);
  expect((await sessionOf(page))?.user ?? null).toBeNull();

  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.found).toBeVisible();
  await claim.confirmIdentity();
  await expect(claim.field('New password')).toBeVisible();
  await claim.button('Go back').click();
  await expect(claim.found).toBeVisible();
  await expect(claim.root.locator('input')).toHaveCount(0);
  await claim.text('No, go back').click();
  await expect(claim.text('How did you sign in to Classic?')).toBeVisible();
  expect(claims).toBe(0);
});
