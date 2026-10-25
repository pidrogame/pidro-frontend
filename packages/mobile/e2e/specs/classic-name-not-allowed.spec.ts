import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { profile } from '../support/api';
import { sessionOf } from '../support/session';

test('a Classic name that cannot be shown is kept private and a new one is picked', async ({
  page,
  player,
}) => {
  await page.goto('/claim-classic');
  const claim = new ClaimClassicScreen(page);
  await claim.verify(`rude-${player.id}`, player.classicPassword);
  await expect(claim.found).toBeVisible();
  await expect(claim.field('New public name')).toHaveCount(0);
  await expect(claim.root).not.toContainText('fuckface', { ignoreCase: true });
  await claim.confirmIdentity();
  await expect(claim.field('New public name')).toBeVisible();
  await expect(claim.root).not.toContainText('fuckface', { ignoreCase: true });

  await claim.field('New public name').fill(`Polite${player.id}`);
  await claim.createAccountAndClaim({
    username: player.name,
    email: player.email,
    password: player.password,
  });
  await page.waitForURL(/\/profile/);
  const screen = new ProfileScreen(page);
  await expect(screen.classicChip).toBeVisible();
  await expect(screen.root).not.toContainText('fuckface', { ignoreCase: true });
  await expect(await screen.openBadges()).not.toContainText('fuckface', { ignoreCase: true });

  const token = (await sessionOf(page))?.accessToken as string;
  expect(JSON.stringify(await profile(token))).not.toMatch(/fuckface/i);
});
