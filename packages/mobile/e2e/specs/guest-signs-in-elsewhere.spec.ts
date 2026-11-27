import { test, expect } from '../fixtures';
import { HomeScreen } from '../screens/home-screen';
import { LoginScreen } from '../screens/login-screen';
import { guest, register, whoAmI } from '../support/api';
import { newPlayer } from '../support/player';
import { sessionOf, startSignedIn } from '../support/session';

test('a guest who signs in to an account is asked before switching players', async ({
  page,
  player,
}) => {
  const account = newPlayer();
  await register(account);
  const started = await guest(player);
  await startSignedIn(page, started);

  await page.goto('/home');
  await new HomeScreen(page).signIn.click();
  const login = new LoginScreen(page);

  // A wrong password leaves the guest as it was, here and on the server.
  await login.signIn(account.email, 'wrong-password');
  await login.switchAccount();
  await expect(login.alert).toBeVisible();
  expect(await sessionOf(page)).toMatchObject({
    accessToken: started.token,
    user: { id: started.user.id, guest: true },
  });
  expect(await whoAmI(started.token)).toMatchObject({ id: started.user.id, guest: true });

  await login.signIn(account.email, account.password);
  await expect(login.switchPlayers).toBeVisible();

  await login.cancelSwitch();
  await expect(login.switchPlayers).toBeHidden();
  expect((await sessionOf(page))?.user?.guest).toBe(true);

  await login.signIn(account.email, account.password);
  await login.switchAccount();
  await expect(new HomeScreen(page).root).toBeVisible();
  const session = await sessionOf(page);
  expect(session?.user).toMatchObject({ guest: false, email: account.email });
});
