import { test, expect } from '../fixtures';
import { AuthSheet } from '../screens/auth-sheet';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { HomeScreen } from '../screens/home-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { WelcomeWindow } from '../screens/welcome-window';
import { guest } from '../support/api';
import { RESERVED_CLASSIC_NAME } from '../support/player';
import { startSignedIn } from '../support/session';

test('every way into the Classic claim opens it in front', async ({ page, player }) => {
  const claim = new ClaimClassicScreen(page);
  const sheet = new AuthSheet(page);
  async function opensInFront() {
    await expect(claim.text('How do you sign in to Pidro today?')).toBeInViewport();
    await expect(sheet.root).toBeHidden();
  }

  // Welcome, before there is a player.
  await page.goto('/');
  await new WelcomeWindow(page).classicPlaque.click({ timeout: 30_000 });
  await opensInFront();

  await startSignedIn(page, await guest(player));

  // A guest's Home.
  await page.goto('/home');
  await new HomeScreen(page).classicPlaque.click();
  await opensInFront();

  // The profile.
  await page.goto('/profile');
  const profile = new ProfileScreen(page);
  await profile.button('Bring your name and games').click();
  await opensInFront();

  // The save sheet's "Claim it instead".
  await page.goto('/profile');
  await profile.saveYourProgress();
  await expect(sheet.root).toBeVisible();
  await sheet.root.getByRole('button', { name: 'Bring your name and games' }).click();
  await opensInFront();

  // The plaque a Classic name brings up on the sheet.
  await page.goto('/profile');
  await profile.saveYourProgress();
  await expect(sheet.root).toBeVisible();
  await sheet.save(player.email, player.password, RESERVED_CLASSIC_NAME);
  await sheet.page.getByRole('button', { name: /^Played Pidro as ReservedRita\?/ }).click();
  await opensInFront();
});
