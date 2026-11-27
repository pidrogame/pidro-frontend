import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { HomeScreen } from '../screens/home-screen';
import { LoginScreen } from '../screens/login-screen';
import { WebResetPage } from '../screens/web-reset-page';
import { claimClassic, login as apiLogin } from '../support/api';
import { resetLinkFor } from '../support/mailbox';
import { sessionOf } from '../support/session';

// Signed out, the form asks Sign in's call (PID-455): an account already moved says its old
// password was typed, emails the new account a sign-in link in one tap (PID-513), and leads
// back to Sign in with the name kept.
test('a Classic account someone already moved says that was the old password, emails a link, and leads back to Sign in', async ({
  page,
  player,
}) => {
  const { user: owner } = await claimClassic(player);
  const [local, domain] = owner.email.split('@');
  const claim = new ClaimClassicScreen(page);
  await page.goto('/claim-classic');
  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.text('That’s your old password')).toBeVisible();
  await expect(
    claim.text(
      /^You moved this account to the new Pidro on \d{1,2} [A-Z][a-z]+ and chose a new password then\.$/
    )
  ).toBeVisible();
  await expect(claim.root.getByRole('link', { name: 'Try again', exact: true })).toBeVisible();
  await expect(claim.field('Username')).toHaveCount(0);
  expect((await sessionOf(page))?.user ?? null).toBeNull();

  await claim.button('Email me a link').click();
  await expect(claim.text(`We sent a sign-in link to ${local[0]}•••@${domain}`)).toBeVisible();
  await claim.button('Back to sign in').click();
  const login = new LoginScreen(page);
  await expect(login.identifier).toHaveValue(player.classicLogin);
  await expect(login.field('Password')).toHaveValue('');
  await expect(login.field('Password')).toBeFocused();

  // The link went to the account it moved to. It sets a new password there, and the app
  // signs in with it.
  await page.goto(await resetLinkFor(owner.email));
  await new WebResetPage(page).setNewPassword(player.newPassword);
  await expect(page).toHaveURL(/\/home$/);
  expect((await apiLogin(player, owner.email)).status).toBe(401);
  await page.goto('/login');
  await login.signIn(player.classicLogin, player.newPassword);
  await expect(new HomeScreen(page).root).toBeVisible();
  expect((await sessionOf(page))?.user?.id).toBe(owner.id);
});
