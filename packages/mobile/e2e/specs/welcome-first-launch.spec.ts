import { test, expect } from '../fixtures';
import { WelcomeWindow } from '../screens/welcome-window';

test('the welcome screen offers an account, a quick game and a new account, and no menu', async ({
  page,
}) => {
  await page.goto('/');
  const welcome = new WelcomeWindow(page);
  await expect(welcome.root).toBeVisible({ timeout: 30_000 });
  await expect(welcome.haveAccount).toContainText('I have an account');
  await expect(welcome.haveAccount).toContainText('From the old Pidro or the new one');
  await expect(welcome.quickGame).toContainText('Quick game');
  await expect(welcome.quickGame).toContainText('You and three bots, no sign-up');
  await expect(welcome.createAccount).toBeVisible();
  // One door for accounts: the old-account plaque and Play online are gone from here.
  await expect(welcome.root.getByText(/Already play Pidro\?|Play online/)).toHaveCount(0);

  // The tab pill belongs to signed-in players.
  for (const tab of ['League', 'Profile', 'Friends'])
    await expect(page.getByRole('button', { name: tab, exact: true })).toHaveCount(0);

  await welcome.haveAccount.click();
  await page.waitForURL(/\/login$/);
});
