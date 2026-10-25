import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { claimClassic, guest } from '../support/api';
import { newPlayer } from '../support/player';
import { sessionOf, startSignedIn } from '../support/session';

test('a Classic account someone already claimed is said so at the preview, with a way to sign in to it', async ({
  page,
  player,
}) => {
  await claimClassic(player);
  const claim = new ClaimClassicScreen(page);
  await page.goto('/claim-classic');
  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.found).toBeVisible();
  await expect(
    claim.text('This Classic account is already linked to a Pidro account.')
  ).toBeVisible();
  await expect(claim.button('Sign in to that account')).toBeVisible();
  await expect(claim.field('Username')).toHaveCount(0);
  expect((await sessionOf(page))?.user ?? null).toBeNull();
});

// Signing in from here would leave the guest, and their games, behind.
test('a guest is told the Classic account is already claimed, and is not offered to sign in to it', async ({
  page,
  player,
}) => {
  await claimClassic(player);
  const started = await guest(newPlayer());
  await startSignedIn(page, started);
  const claim = new ClaimClassicScreen(page);
  await page.goto('/claim-classic');
  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(
    claim.text('This Classic account is already linked to a Pidro account.')
  ).toBeVisible();
  await expect(claim.root.getByRole('link', { name: 'No, go back', exact: true })).toBeVisible();
  await expect(claim.button('Sign in to that account')).toHaveCount(0);
  await expect(claim.button("Yes, that's me")).toHaveCount(0);
  await expect(claim.button('Save and play')).toHaveCount(0);
  expect((await sessionOf(page))?.user).toMatchObject({ id: started.user.id, guest: true });
});
