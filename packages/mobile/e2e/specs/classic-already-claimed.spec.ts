import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { LoginScreen } from '../screens/login-screen';
import { claimClassic, guest, whoAmI } from '../support/api';
import { newPlayer } from '../support/player';
import { sessionOf, startSignedIn } from '../support/session';

// Signed out, the form asks Sign in's call (PID-455): an account already moved says its old
// password was typed, and leads back to Sign in with the name kept.
test('a Classic account someone already moved says that was the old password, and leads back to Sign in', async ({
  page,
  player,
}) => {
  await claimClassic(player);
  const claim = new ClaimClassicScreen(page);
  await page.goto('/claim-classic');
  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.text('That’s your old password')).toBeVisible();
  await expect(
    claim.text(
      /^You moved this account to the new Pidro on \d{1,2} [A-Z][a-z]+ and chose a new password then\.$/
    )
  ).toBeVisible();
  await expect(
    claim.root.getByRole('link', { name: 'Forgot it? Email me a link', exact: true })
  ).toBeVisible();
  await expect(claim.field('Username')).toHaveCount(0);
  expect((await sessionOf(page))?.user ?? null).toBeNull();

  await claim.button('Try again').click();
  const login = new LoginScreen(page);
  await expect(login.identifier).toHaveValue(player.classicLogin);
  await expect(login.field('Password')).toHaveValue('');
  await expect(login.field('Password')).toBeFocused();
});

// Every new install is a guest, so a guest has to get through to the account too.
test('a guest who verifies an already-claimed Classic account signs in to it from there', async ({
  page,
  player,
}) => {
  const owner = await claimClassic(player);
  const started = await guest(newPlayer());
  await startSignedIn(page, started);
  const claim = new ClaimClassicScreen(page);
  await page.goto('/claim-classic');
  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.text('Already in Pidro')).toBeVisible();
  await expect(claim.button("Yes, that's me")).toHaveCount(0);
  // This guest hasn't played, so there is nothing to leave behind.
  await expect(claim.text("Your guest games won't come along.")).toHaveCount(0);
  await claim.button('Sign in').click();

  const login = new LoginScreen(page);
  await expect(login.identifier).toHaveValue(player.classicLogin);
  await login.signIn(player.classicLogin, player.password);
  await expect(login.switchPlayers).toBeVisible();
  await login.switchAccount();

  await expect.poll(async () => (await sessionOf(page))?.user?.id).toBe(owner.user.id);
  const session = await sessionOf(page);
  expect(await whoAmI(session!.accessToken!)).toMatchObject({ id: owner.user.id, guest: false });
});
