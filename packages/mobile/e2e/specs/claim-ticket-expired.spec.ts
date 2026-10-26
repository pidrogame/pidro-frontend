import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { untilAfter } from '../support/clock';

// Runs against the backend started with CLASSIC_CLAIM_TICKET_TTL_SECONDS=1.
test('an expired claim says to verify again @second-run', async ({ page, player }) => {
  await page.goto('/claim-classic');
  const claim = new ClaimClassicScreen(page);
  const verified = await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.found).toBeVisible();

  const { expires_at } = (await verified.json()).data;
  await untilAfter(Date.parse(expires_at) + 1_000);

  await claim.confirmIdentity();
  await claim.createAccountAndClaim({
    username: player.name,
    email: player.email,
    password: player.password,
  });
  await expect(claim.alert).toContainText('Please start again to find your Pidro account.');
  await expect(claim.found).toBeHidden();

  // Verifying again gets a fresh claim.
  await claim.verify(player.classicLogin, player.classicPassword);
  await expect(claim.found).toBeVisible();
});
