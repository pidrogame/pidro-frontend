import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { AuthSheet } from '../screens/auth-sheet';
import { HomeScreen } from '../screens/home-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { guest, login, profile, whoAmI } from '../support/api';
import { sessionOf, startSignedIn } from '../support/session';

test('a guest claims their Classic account with an email and password and keeps their player', async ({
  page,
  player,
}) => {
  const started = await guest(player);
  await startSignedIn(page, started);
  await page.goto('/home');
  await new HomeScreen(page).classicPlaque.click();

  const claim = new ClaimClassicScreen(page);
  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.found).toBeVisible();
  await expect(claim.text('Create your Pidro account')).toBeHidden();
  await expect(claim.field('Username')).toBeHidden();
  await expect(claim.root.locator('input')).toHaveCount(0);
  await claim.confirmIdentity();

  await claim.button('Save and play').click();
  // A server that offers the Classic email keeps it without asking.
  const offered = await claim.newAccount();
  if (!offered?.email) await expect(claim.text('Enter an email address.')).toBeVisible();
  await claim.fillLogin({ email: player.email, password: 'short' });
  await claim.button('Save and play').click();
  await expect(claim.text('Use 8 characters or more.')).toBeVisible();

  const { email } = await claim.fillLogin({ email: player.email, password: player.password });
  await claim.button('Save and play').click();
  await page.waitForURL(/\/profile/);
  await expect(new ProfileScreen(page).classicChip).toBeVisible();
  const session = await sessionOf(page);
  expect(session?.user?.id).toBe(started.user.id);
  expect(session?.user?.guest).toBeFalsy();
  await expect(new AuthSheet(page).root).toBeHidden();
  const token = session?.accessToken as string;
  expect(await whoAmI(token)).toMatchObject({
    id: started.user.id,
    guest: false,
    email,
  });
  expect((await profile(token)).classic).toMatchObject({ name: player.classicLogin });
  // The password typed is the way back in.
  expect((await login(player, email)).status).toBe(200);

  // One Classic account per player: a second one is refused.
  // The guest session is seeded on every load; seed the claimed one after it.
  await startSignedIn(page, { token, user: session?.user as object });
  await page.goto('/claim-classic');
  await claim.verify(`${player.classicLogin}b`, player.classicPassword);
  await expect(claim.found).toBeVisible();
  await claim.confirmIdentity();
  await expect(claim.alert).toBeVisible();
  await expect(claim.alert).toContainText(
    'You’ve already brought a different player’s name and games to this account.'
  );
});
