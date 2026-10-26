import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { ClassicForgotScreen } from '../screens/classic-forgot-screen';
import { LoginScreen } from '../screens/login-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { classicCodeFor } from '../support/mailbox';
import { profile, whoAmI } from '../support/api';
import { sessionOf } from '../support/session';

test('a Classic player recovers by emailed code from sign in and claims their account @responsive', async ({
  page,
  player,
}) => {
  await page.goto('/login');
  await new LoginScreen(page).forgotPassword.click();
  await page.getByText('Use the old Pidro app? Find your account', { exact: true }).click();
  const forgot = new ClassicForgotScreen(page);
  await forgot.login.fill(player.classicLogin);
  await forgot.button('Email me a code').click();
  await expect(forgot.field('Six-digit code')).toBeVisible();
  const code = await classicCodeFor(`${player.classicLogin}@classic.example`);
  await forgot.field('Six-digit code').fill(code);

  const claim = new ClaimClassicScreen(page);
  await expect(claim.found).toBeVisible();
  await expect(claim.text(player.classicLogin)).toBeVisible();
  await expect(claim.root.locator('input')).toHaveCount(0);
  await claim.confirmIdentity();
  await expect(claim.text(`Your name stays ${player.classicLogin}.`)).toBeVisible();
  await expect(claim.kept('Email', `${player.classicLogin}@classic.example`)).toHaveCount(0);
  await expect(claim.field('Email')).toHaveCount(0);
  await claim.createAccountAndClaim({
    username: player.name,
    email: player.email,
    password: player.password,
  });
  await page.waitForURL(/\/profile/);
  await expect(new ProfileScreen(page).classicChip).toBeVisible();
  const session = await sessionOf(page);
  expect(session?.user).toMatchObject({
    guest: false,
    username: player.classicLogin,
    email: `${player.classicLogin}@classic.example`,
  });
  expect(await whoAmI(session!.accessToken!)).toMatchObject({
    id: session!.user!.id,
    guest: false,
  });
  expect((await profile(session!.accessToken!)).classic).toMatchObject({
    name: player.classicLogin,
    level: 42,
  });
});

test('a wrong Classic code clears and focuses the field, then a valid code returns to claim @responsive', async ({
  page,
  player,
}) => {
  await page.goto('/claim-classic');
  const claim = new ClaimClassicScreen(page);
  await claim.button('Username and password').click();
  await claim.field('Username or email').fill(player.classicLogin);
  await claim.text('Forgot your password?').click();
  const forgot = new ClassicForgotScreen(page);
  await expect(forgot.login).toHaveValue(player.classicLogin);
  await forgot.button('Email me a code').click();
  const code = await classicCodeFor(`${player.classicLogin}@classic.example`);
  const wrong = `${code[0] === '0' ? '1' : '0'}${code.slice(1)}`;
  await forgot.field('Six-digit code').fill(wrong);
  await expect(forgot.alert).toHaveText("That code didn't work. Ask for a new one.");
  await expect(forgot.field('Six-digit code')).toHaveValue('');
  await expect(forgot.field('Six-digit code')).toBeFocused();
  await expect(forgot.button('Continue')).toBeDisabled();
  await expect(forgot.text('No longer use that email? Get help')).toBeVisible();
  await forgot.field('Six-digit code').fill(code);
  await expect(claim.found).toBeVisible();
  await expect(claim.text(player.classicLogin)).toBeVisible();
});
