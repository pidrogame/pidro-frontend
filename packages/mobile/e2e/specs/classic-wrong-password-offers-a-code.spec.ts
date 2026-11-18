import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { ClassicForgotScreen } from '../screens/classic-forgot-screen';

// PID-312: a player with an emailed code may type it into the password box.
test('after two wrong passwords for one login, the claim offers to email a code @responsive', async ({
  page,
  player,
}) => {
  // The old-account flow's own screens; Sign in leads here when it finds one.
  await page.goto('/claim-classic');
  const claim = new ClaimClassicScreen(page);
  const offer = claim.text(/We can email you a code/);
  const emailCode = claim.root.getByRole('link', { name: 'Email me a code', exact: true });

  // Signed out the form asks Sign in's call (PID-455), which answers an unreachable old
  // Pidro like a wrong password; classic-unreachable-keeps-the-session covers the outage.
  await claim.verify(player.classicLogin, 'wrong');
  await expect(claim.alert).toHaveText('That name and password don’t match.');
  await expect(offer).toBeHidden();
  await claim.retryPassword('123456');
  await expect(offer).toHaveText(
    'Still not working? We can email you a code. A code from us goes on its own screen, not in this box.'
  );
  await expect(claim.text('That name and password don’t match.')).toBeHidden();

  // Another login starts the count again.
  await claim.field('Username or email').fill(`${player.classicLogin}x`);
  await expect(offer).toBeHidden();
  await claim.verify(player.classicLogin, 'wrong');
  await expect(offer).toBeHidden();
  await claim.retryPassword('wrong');
  await expect(offer).toBeVisible();

  await emailCode.click();
  await expect(new ClassicForgotScreen(page).login).toHaveValue(player.classicLogin);
});
