import { test, expect } from '../fixtures';
import { AuthSheet } from '../screens/auth-sheet';
import { ProfileScreen } from '../screens/profile-screen';
import { guest } from '../support/api';
import { startSignedIn } from '../support/session';

test('a guest who signs out is offered saving first', async ({ page, player }) => {
  await startSignedIn(page, await guest(player));
  await page.goto('/profile');
  const settings = await new ProfileScreen(page).openAccount();
  await settings.askToSignOut();
  await expect(settings.savePrompt).toBeVisible();

  await settings.saveAccount.click();
  await expect(new AuthSheet(page).root).toBeVisible();
});
