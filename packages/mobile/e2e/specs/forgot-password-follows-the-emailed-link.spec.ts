import { test, expect } from '../fixtures';
import { ForgotPasswordScreen } from '../screens/forgot-password-screen';
import { HomeScreen } from '../screens/home-screen';
import { ResetPasswordScreen } from '../screens/reset-password-screen';
import { login, register } from '../support/api';
import { resetScreenFor } from '../support/mailbox';
import { sessionOf } from '../support/session';

test("the emailed link opens the app's reset screen, and the new password signs in", async ({
  page,
  player,
}) => {
  const { user } = await register(player);
  await page.goto('/forgot-password');
  const forgot = new ForgotPasswordScreen(page);
  await forgot.identifier.fill(player.email);
  await forgot.requestLink();

  // The link opens the app's own reset screen with its token, as on a phone.
  await page.goto(await resetScreenFor(player.email));
  await new ResetPasswordScreen(page).setNewPassword(player.newPassword);
  await expect(new HomeScreen(page).root).toBeVisible();
  expect((await sessionOf(page))?.user?.id).toBe(user.id);

  expect((await login(player, player.email)).status).toBe(401);
  expect((await login(player, player.email, player.newPassword)).status).toBe(200);
});
