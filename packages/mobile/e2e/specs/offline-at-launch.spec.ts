import { test, expect } from '../fixtures';
import { WelcomeWindow } from '../screens/welcome-window';

test('offline, Welcome says so and holds the buttons, and plays on once back online', async ({
  context,
  page,
}) => {
  await page.goto('/');
  const welcome = new WelcomeWindow(page);
  await expect(welcome.root).toBeVisible({ timeout: 30_000 });
  await expect(welcome.quickGame).toBeEnabled();

  await context.setOffline(true);
  await expect(welcome.text("You're offline. Connect to play.")).toBeVisible();
  await expect(welcome.quickGame).toBeDisabled();
  await expect(welcome.haveAccount).toBeDisabled();

  await context.setOffline(false);
  await expect(welcome.text("You're offline. Connect to play.")).toBeHidden();
  await expect(welcome.quickGame).toBeEnabled();
});
