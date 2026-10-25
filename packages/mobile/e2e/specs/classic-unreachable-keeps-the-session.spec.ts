import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { guest, register, whoAmI } from '../support/api';
import { sessionOf, startSignedIn } from '../support/session';

test.use({ unavailableExpected: true });

const starts = [
  { name: 'a guest', start: guest },
  { name: 'a signed-in player', start: register },
];

for (const { name, start } of starts) {
  test(`${name} verifying a Classic password while Classic is down reads why and stays who they were`, async ({
    page,
    player,
  }) => {
    const started = await start(player);
    await startSignedIn(page, started);
    await page.goto('/claim-classic');

    const claim = new ClaimClassicScreen(page);
    const answered = await claim.verify(`down-${player.id}`, player.classicPassword);
    expect(answered.status()).toBe(503);
    await expect(claim.alert).toHaveText(
      'Classic or the sign-in provider is temporarily unavailable. Try again.'
    );
    await expect(claim.found).toBeHidden();
    await expect(claim.button('Find my account')).toBeEnabled();

    // Still this player in the app and on the server.
    const session = await sessionOf(page);
    expect(session?.accessToken).toBe(started.token);
    expect(session?.user?.id).toBe(started.user.id);
    expect(await whoAmI(started.token)).toMatchObject({
      id: started.user.id,
      guest: start === guest,
    });
  });
}
