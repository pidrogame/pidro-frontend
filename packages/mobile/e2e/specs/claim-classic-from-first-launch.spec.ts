import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { HomeScreen } from '../screens/home-screen';
import { LoginScreen } from '../screens/login-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { WelcomeWindow } from '../screens/welcome-window';
import { profile, whoAmI } from '../support/api';
import { REUSABLE_CLASSIC_PASSWORD, UNICODE_CLASSIC_PASSWORD } from '../support/classic-stand-in';
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
  await expect(claim.text(`Found you, ${player.classicLogin}.`)).toBeVisible();
  await expect(claim.text('Your old password was right.')).toBeVisible();
  await expect(
    claim.text(
      'The new Pidro needs at least 8 characters, so choose a new password. Your account and your points stay.'
    )
  ).toBeVisible();
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

test('an eight-character Classic password claims without a second password and signs in again @responsive', async ({
  page,
  player,
}) => {
  const name = `reusable-${player.id}`;
  await page.goto('/claim-classic');
  const claim = new ClaimClassicScreen(page);
  await claim.verify(name, REUSABLE_CLASSIC_PASSWORD);
  await expect(claim.found).toBeVisible();
  await claim.confirmIdentity();
  await expect(claim.text(`Found you, ${name}.`)).toBeVisible();
  await expect(
    claim.text('Your old password was right. Keep using it in the new Pidro.')
  ).toBeVisible();
  await expect(claim.root.locator('input')).toHaveCount(0);
  await claim.button('Save and play').click();
  await page.waitForURL(/\/profile/);
  const session = await sessionOf(page);
  expect((await profile(session!.accessToken!)).classic).toMatchObject({ name, level: 42 });
  await new ProfileScreen(page).signOut();
  await page.waitForURL(/\/welcome$/);
  await page.goto('/login');
  await new LoginScreen(page).signIn(name, REUSABLE_CLASSIC_PASSWORD);
  await expect(new HomeScreen(page).root).toBeVisible();
  expect((await sessionOf(page))?.user?.id).toBe(session?.user?.id);
});

test('a reused password refused by the server opens the field so the player can finish', async ({
  page,
  player,
}) => {
  const name = `unicode-${player.id}`;
  await page.goto('/claim-classic');
  const claim = new ClaimClassicScreen(page);
  await claim.verify(name, UNICODE_CLASSIC_PASSWORD);
  await expect(claim.found).toBeVisible();
  await claim.confirmIdentity();
  await expect(claim.root.locator('input')).toHaveCount(0);
  await claim.button('Save and play').click();
  await expect(claim.field('New password')).toBeVisible();
  await expect(claim.text('Use 8 characters or more.')).toBeVisible();
  await expect(claim.text('Your old password was right.')).toBeVisible();
  await claim.field('New password').fill(player.password);
  await claim.button('Save and play').click();
  await page.waitForURL(/\/profile/);
  await expect(new ProfileScreen(page).classicChip).toBeVisible();
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
  await expect(claim.text('How do you sign in to Pidro today?')).toBeVisible();
  await expect(claim.root.locator('input')).toHaveCount(0);
  await expect(claim.text("Don't remember? Get help")).toBeVisible();

  await claim.button('Username and password').click();
  await expect(claim.text('Sign in as you do in the old app')).toBeVisible();
  await claim.text('Used Apple or Facebook instead?').click();
  await expect(claim.text('How do you sign in to Pidro today?')).toBeVisible();
  await expect(claim.root.locator('input')).toHaveCount(0);

  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.found).toBeVisible();
  await expect(claim.root.locator('input')).toHaveCount(0);
  await claim.text('No, go back').click();
  await expect(claim.text('How do you sign in to Pidro today?')).toBeVisible();
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
  await expect(claim.text('How do you sign in to Pidro today?')).toBeVisible();
  expect(claims).toBe(0);
});
