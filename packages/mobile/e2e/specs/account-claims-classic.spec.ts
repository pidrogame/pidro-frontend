import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { profile, register, whoAmI } from '../support/api';
import { sessionOf, startSignedIn } from '../support/session';

test('a saved account claims its Classic account and keeps its player', async ({
  page,
  player,
}) => {
  const account = await register(player);
  await startSignedIn(page, account);
  await page.goto('/profile');
  await new ProfileScreen(page).button('Claim Pidro Classic').click();

  const claim = new ClaimClassicScreen(page);
  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.found).toBeVisible();
  // Signed in already, so no new account is asked for.
  await expect(claim.text('Create your Pidro account')).toBeHidden();
  await expect(claim.root.locator('input')).toHaveCount(0);
  await claim.confirmIdentity();

  await page.waitForURL(/\/profile/);
  await expect(new ProfileScreen(page).classicChip).toBeVisible();
  const session = await sessionOf(page);
  expect(session?.user).toMatchObject({ id: account.user.id, guest: false, email: player.email });
  const token = session?.accessToken as string;
  expect(await whoAmI(token)).toMatchObject({ id: account.user.id, guest: false });
  expect((await profile(token)).classic).toMatchObject({ name: player.classicLogin });
});

test('a saved player can retry a refused direct claim on the details step', async ({
  page,
  player,
}) => {
  const account = await register(player);
  await startSignedIn(page, account);
  let attempts = 0;
  await page.route('**/api/v1/classic/claim', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Please try claiming again.' } }),
      });
    } else {
      await route.continue();
    }
  });
  await page.goto('/claim-classic');
  const claim = new ClaimClassicScreen(page);
  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.found).toBeVisible();
  await expect(claim.root.locator('input')).toHaveCount(0);
  expect(attempts).toBe(0);
  await claim.confirmIdentity();
  await expect(claim.alert).toBeVisible();
  await expect(claim.found).toBeVisible();
  await expect(claim.button('Save and play')).toBeEnabled();
  await expect(claim.root.locator('input')).toHaveCount(0);
  expect(attempts).toBe(1);
  expect((await sessionOf(page))?.user?.id).toBe(account.user.id);

  await claim.button('Save and play').click();
  await page.waitForURL(/\/profile/);
  await expect(new ProfileScreen(page).classicChip).toBeVisible();
  expect(attempts).toBe(2);
  const session = await sessionOf(page);
  expect(session?.user?.id).toBe(account.user.id);
  expect((await profile(session!.accessToken!)).classic).toMatchObject({
    name: player.classicLogin,
  });
});
