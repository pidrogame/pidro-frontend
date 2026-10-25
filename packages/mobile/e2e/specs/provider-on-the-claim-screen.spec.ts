import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { ProfileScreen } from '../screens/profile-screen';
import { profile } from '../support/api';
import { answerNextTap, identity, shapes } from '../support/identity';
import { sessionOf } from '../support/session';

for (const shape of shapes) {
  test.describe(shape.name, () => {
    test('finds the same Classic account as the password does', async ({ page, player }) => {
      const claim = new ClaimClassicScreen(page);
      await page.goto('/claim-classic');
      await answerNextTap(page, await shape.answer(identity(player.classicLogin)));
      await claim.button(shape.button).click();
      await expect(claim.found).toBeVisible();
      await expect(claim.text(player.classicLogin)).toBeVisible();

      await expect(claim.root.locator('input')).toHaveCount(0);
      await claim.confirmIdentity();
      await expect(claim.text('Create your Pidro account')).toBeVisible();
      await expect(claim.field('New password')).toHaveCount(0);
      await claim.field('Username').fill(player.name);
      await claim.button('Save and play').click();
      await page.waitForURL(/\/profile/);
      await expect(new ProfileScreen(page).classicChip).toBeVisible();
      const token = (await sessionOf(page))?.accessToken as string;
      expect((await profile(token)).classic).toMatchObject({
        name: player.classicLogin,
        level: 42,
      });
    });

    test('says so when no Classic account uses that identity', async ({ page, player }) => {
      const claim = new ClaimClassicScreen(page);
      await page.goto('/claim-classic');
      await answerNextTap(page, await shape.answer(identity(`new-${player.id}`)));
      await claim.button(shape.button).click();
      await expect(claim.alert).toContainText(
        `No Classic account uses that ${shape.brand} account.`
      );
      await expect(claim.found).toBeHidden();
    });
  });
}
