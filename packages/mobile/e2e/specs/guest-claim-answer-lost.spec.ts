import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { HomeScreen } from '../screens/home-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { guest, whoAmI } from '../support/api';
import { sessionOf, startSignedIn } from '../support/session';

test('when a guest’s claim was saved but the answer was lost, they are recovered as the same player', async ({
  page,
  player,
}) => {
  const started = await guest(player);
  await startSignedIn(page, started);
  // The request reaches the server; the answer never reaches the app.
  let attempts = 0;
  await page.route('**/api/v1/classic/claim', async (route) => {
    attempts += 1;
    await route.fetch();
    await route.abort('connectionreset');
  });

  await page.goto('/home');
  await new HomeScreen(page).classicPlaque.click();
  const claim = new ClaimClassicScreen(page);
  await claim.verify(player.classicLogin, player.classicPassword);
  await claim.found.waitFor();
  await claim.confirmIdentity();
  const { email } = await claim.fillLogin({ email: player.email, password: player.password });
  await claim.button('Save and play').click();

  await page.waitForURL(/\/profile/);
  await expect(new ProfileScreen(page).classicChip).toBeVisible();
  expect(attempts).toBe(1);
  const session = await sessionOf(page);
  expect(session?.user).toMatchObject({ id: started.user.id, guest: false });
  expect(await whoAmI(session?.accessToken as string)).toMatchObject({
    id: started.user.id,
    guest: false,
    email,
  });
});
