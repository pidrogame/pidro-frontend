import { test, expect } from '../fixtures';
import { AuthSheet } from '../screens/auth-sheet';
import { ProfileScreen } from '../screens/profile-screen';
import { guest, register, whoAmI } from '../support/api';
import { newPlayer, RESERVED_CLASSIC_NAME } from '../support/player';
import { sessionOf, startSignedIn } from '../support/session';

test('a taken email, a taken name and a Classic name are refused on the field, and the guest is still usable', async ({
  page,
  player,
}) => {
  const holder = newPlayer();
  await register(holder);
  const started = await guest(player);
  await startSignedIn(page, started);
  await page.goto('/profile');
  await new ProfileScreen(page).saveYourProgress();
  const sheet = new AuthSheet(page);
  await expect(sheet.root).toBeVisible();

  // A field's error is the sheet's only alert: no general notice beside it.
  const alerts = sheet.root.getByRole('alert');
  await sheet.save(holder.email, player.password, player.name);
  await expect(alerts).toHaveText([/email/i]);

  await sheet.save(player.email, player.password, holder.name);
  await expect(alerts).toHaveText(['That name is taken.']);

  await sheet.save(player.email, player.password, RESERVED_CLASSIC_NAME);
  await expect(sheet.root.getByText('That name is taken.')).toBeVisible();
  await expect(sheet.page.getByRole('button', { name: /^Played Pidro as/ })).toBeVisible();

  // Nothing was saved: still the same guest, here and on the server.
  const session = await sessionOf(page);
  expect(session?.user).toMatchObject({ id: started.user.id, guest: true });
  expect(await whoAmI(started.token)).toMatchObject({ id: started.user.id, guest: true });

  // And the sheet still saves once the fields are right.
  await sheet.save(player.email, player.password, player.name);
  await expect(sheet.root).toBeHidden();
  const saved = await sessionOf(page);
  expect(await whoAmI(saved?.accessToken as string)).toMatchObject({
    id: started.user.id,
    guest: false,
    email: player.email,
  });
});
