import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { HomeScreen } from '../screens/home-screen';
import { LoginScreen } from '../screens/login-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { profile } from '../support/api';
import { answerNextTap, identity, shapes } from '../support/identity';
import { sessionOf } from '../support/session';

for (const shape of shapes) {
  test(`${shape.name}: an identity Classic knows is confirmed as that Classic player, and the next sign-in goes straight in`, async ({
    page,
    player,
  }) => {
    const who = identity(player.classicLogin);
    const login = new LoginScreen(page);
    await page.goto('/login');
    await answerNextTap(page, await shape.answer(who));
    await login.button(shape.button).click();

    const claim = new ClaimClassicScreen(page);
    await expect(claim.found).toBeVisible();
    await expect(claim.text(player.classicLogin)).toBeVisible();
    await expect(claim.root.locator('input')).toHaveCount(0);
    // Signed out, the server offers the Classic username, so nothing is typed (PID-301).
    await claim.confirmIdentity();
    await page.waitForURL(/\/profile/);
    expect((await sessionOf(page))?.user?.username).toBe(player.classicLogin);
    await expect(new ProfileScreen(page).classicChip).toBeVisible();

    const claimed = await sessionOf(page);
    expect((await profile(claimed?.accessToken as string)).classic).toMatchObject({
      name: player.classicLogin,
      level: 42,
    });

    await new ProfileScreen(page).signOut();
    await page.waitForURL(/\/welcome$/);

    await page.goto('/login');
    await answerNextTap(page, await shape.answer(who));
    await login.button(shape.button).click();
    await expect(new HomeScreen(page).root).toBeVisible();
    expect((await sessionOf(page))?.user?.id).toBe(claimed?.user?.id);
  });
}
