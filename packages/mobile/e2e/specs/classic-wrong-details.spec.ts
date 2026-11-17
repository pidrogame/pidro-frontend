import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { WelcomeWindow } from '../screens/welcome-window';

test('someone who mistypes their Classic details is told and can try again', async ({
  page,
  player,
}) => {
  await page.goto('/');
  await new WelcomeWindow(page).classicPlaque.click({ timeout: 30_000 });
  const claim = new ClaimClassicScreen(page);
  await expect(claim.root).toBeVisible();

  await claim.verify(player.classicLogin, 'wrong');
  await expect(claim.alert).toHaveText('That name and password don’t match.');
  await claim.verify(`nobody-${player.id}`, player.classicPassword);
  await expect(claim.alert).toHaveText('That name and password don’t match.');
  // Signed out this is Sign in's call (PID-455), which answers a switched-off account the same.
  await claim.verify(`off-${player.id}`, player.classicPassword);
  await expect(claim.alert).toHaveText('That name and password don’t match.');
  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.found).toBeVisible();
});
