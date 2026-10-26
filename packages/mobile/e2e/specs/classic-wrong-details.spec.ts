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
  await expect(claim.alert).toHaveText('Invalid sign-in credentials.');
  await claim.verify(`nobody-${player.id}`, player.classicPassword);
  await expect(claim.alert).toHaveText('Invalid sign-in credentials.');
  await claim.verify(`off-${player.id}`, player.classicPassword);
  await expect(claim.alert).toHaveText('This Pidro account is inactive. Please contact support.');
  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.found).toBeVisible();
});
