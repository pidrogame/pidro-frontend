import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { HomeScreen } from '../screens/home-screen';
import { LoginScreen } from '../screens/login-screen';
import { claimClassic } from '../support/api';
import { sessionOf } from '../support/session';

// PID-455: one Sign in for every account, and it always says what to do next.
test('Sign in takes the old Pidro name and password, and tells a moved account it was the old one', async ({
  page,
  player,
}) => {
  const login = new LoginScreen(page);
  const claim = new ClaimClassicScreen(page);

  await test.step('a name and password nobody knows do not match', async () => {
    await page.goto('/login');
    await login.signIn(`nobody-${player.id}`, 'wrong-password');
    await expect(login.alert).toHaveText('That name and password don’t match.');
    expect((await sessionOf(page))?.user ?? null).toBeNull();
  });

  await test.step('only the old Pidro knows them, not moved yet: "Is this you?"', async () => {
    await login.signIn(player.classicLogin, player.classicPassword);
    await expect(claim.found).toBeVisible();
    await expect(claim.stat('games')).toBeVisible();
    expect((await sessionOf(page))?.user ?? null).toBeNull();
  });

  const owner = await claimClassic(player);

  await test.step('only the old Pidro knows them, already moved: the old password', async () => {
    await page.goto('/login');
    await login.signIn(player.classicLogin, player.classicPassword);
    await expect(claim.text('That’s your old password')).toBeVisible();
    await expect(claim.text(/chose a new password then\.$/)).toBeVisible();
    expect((await sessionOf(page))?.user ?? null).toBeNull();
    await expect(claim.button('Email me a link')).toBeVisible();
    await claim.root.getByRole('link', { name: 'Try again', exact: true }).click();
    await expect(login.identifier).toHaveValue(player.classicLogin);
    await expect(login.field('Password')).toBeFocused();
  });

  // The move kept the old name; the password is the one chosen then.
  await test.step('the new Pidro knows the name and new password: signed in', async () => {
    await login.signIn(player.classicLogin, player.password);
    await expect(new HomeScreen(page).root).toBeVisible();
    expect((await sessionOf(page))?.user?.id).toBe(owner.user.id);
  });
});
