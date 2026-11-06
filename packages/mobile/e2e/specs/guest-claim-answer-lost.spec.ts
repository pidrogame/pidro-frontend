import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { HomeScreen } from '../screens/home-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { guest, whoAmI } from '../support/api';
import { REUSABLE_CLASSIC_PASSWORD } from '../support/classic-stand-in';
import { sessionOf, startSignedIn } from '../support/session';

for (const reuse of [false, true]) {
  test(`when a guest’s claim was saved but the answer was lost, they are recovered as the same player (${reuse ? 'reused' : 'new'} password)`, async ({
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
    await claim.verify(
      reuse ? `reusable-${player.id}` : player.classicLogin,
      reuse ? REUSABLE_CLASSIC_PASSWORD : player.classicPassword
    );
    await claim.found.waitFor();
    await claim.confirmIdentity();
    let email: string;
    if (reuse) {
      await expect(claim.root.locator('input')).toHaveCount(0);
      email = (await claim.newAccount())!.email!;
    } else {
      ({ email } = await claim.fillLogin({ email: player.email, password: player.password }));
    }
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
}
