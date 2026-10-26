import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { LoginScreen } from '../screens/login-screen';
import { claimClassic, guest, whoAmI } from '../support/api';
import { newPlayer } from '../support/player';
import { sessionOf, startSignedIn } from '../support/session';

test('a Classic account someone already claimed says so at the preview, with a way to sign in to it', async ({
  page,
  player,
}) => {
  await claimClassic(player);
  const claim = new ClaimClassicScreen(page);
  await page.goto('/claim-classic');
  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.text('Already in Pidro')).toBeVisible();
  await expect(claim.text('Sign in with your username and password.')).toBeVisible();
  await expect(claim.button('Sign in')).toBeVisible();
  await expect(
    claim.root.getByRole('link', { name: 'Forgot password?', exact: true })
  ).toBeVisible();
  await expect(claim.field('Username')).toHaveCount(0);
  expect((await sessionOf(page))?.user ?? null).toBeNull();
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
