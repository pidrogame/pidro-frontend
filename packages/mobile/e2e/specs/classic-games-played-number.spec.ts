import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { WelcomeWindow } from '../screens/welcome-window';

// What Classic kept: an old total (frozen in 2016) and a counter used since.
const accounts = [
  { kind: 'oldtotal', title: 'only the old total', games: '300' },
  { kind: 'counter', title: 'a counter at or above the old total', games: '1,284' },
  { kind: 'lower', title: 'a counter below the old total', games: '340' },
];

for (const { kind, title, games } of accounts) {
  test(`a Classic account with ${title} shows ${games} games played`, async ({ page, player }) => {
    await page.goto('/');
    await new WelcomeWindow(page).classicPlaque.click({ timeout: 30_000 });
    const claim = new ClaimClassicScreen(page);
    await claim.verify(`${kind}-${player.id}`, player.classicPassword);
    await expect(claim.found).toBeVisible();
    await expect(claim.stat('games')).toHaveAttribute('aria-label', `games: ${games}`);
    await expect(claim.stat('level')).toHaveAttribute('aria-label', 'level: 42');
    await expect(claim.stat('since')).toBeVisible();

    await claim.confirmIdentity();
    await claim.createAccountAndClaim({
      username: player.name,
      email: player.email,
      password: player.password,
    });
    await page.waitForURL(/\/profile/);
    // A new account has no Pidro games yet, so its record is the Classic number.
    const profile = new ProfileScreen(page);
    await expect(profile.stat('Games played')).toHaveAttribute(
      'aria-label',
      `Games played: ${games}`
    );
    await expect(await profile.openBadges()).toContainText(`${games} games`);
  });
}
