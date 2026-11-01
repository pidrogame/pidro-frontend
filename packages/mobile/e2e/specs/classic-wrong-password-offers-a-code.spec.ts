import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { ClassicForgotScreen } from '../screens/classic-forgot-screen';
import { WelcomeWindow } from '../screens/welcome-window';

test.use({ unavailableExpected: true });

// PID-312: a player with an emailed code may type it into the password box.
test('after two wrong passwords for one login, the claim offers to email a code @responsive', async ({
  page,
  player,
}) => {
  await page.goto('/');
  await new WelcomeWindow(page).classicPlaque.click({ timeout: 30_000 });
  const claim = new ClaimClassicScreen(page);
  const offer = claim.text(/We can email you a code/);
  const emailCode = claim.root.getByRole('link', { name: 'Email me a code', exact: true });

  // Classic being down is not a wrong password.
  await claim.verify(`down-${player.id}`, 'wrong');
  await claim.retryPassword('wrong');
  await expect(claim.alert).toHaveText('We can’t reach your Pidro account right now. Try again.');
  await expect(offer).toBeHidden();

  await claim.verify(player.classicLogin, 'wrong');
  await expect(claim.alert).toHaveText('Invalid sign-in credentials.');
  await expect(offer).toBeHidden();
  await claim.retryPassword('123456');
  await expect(offer).toHaveText(
    'Still not working? We can email you a code. A code from us goes on its own screen, not in this box.'
  );
  await expect(claim.text('Invalid sign-in credentials.')).toBeHidden();

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
