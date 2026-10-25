import { test, expect } from '../fixtures';
import { ClaimClassicScreen } from '../screens/claim-classic-screen';
import { RegisterScreen } from '../screens/register-screen';
import { RESERVED_CLASSIC_NAME } from '../support/player';

test('a name reserved for a Classic player offers the claim', async ({ page, player }) => {
  const create = new RegisterScreen(page);
  await page.goto('/register');
  await create.createAccount({ ...player, name: RESERVED_CLASSIC_NAME });
  await expect(create.text('That name is taken.')).toBeVisible();

  await create.page.getByRole('button', { name: /^Played Classic as ReservedRita\?/ }).click();
  const claim = new ClaimClassicScreen(page);
  await expect(claim.text('How did you sign in to Classic?')).toBeVisible();
});
