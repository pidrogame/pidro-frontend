import { test, expect } from '../fixtures';
import { AgeScreen } from '../screens/age-screen';
import { HomeScreen } from '../screens/home-screen';
import { WelcomeWindow } from '../screens/welcome-window';
import { api, guest, register } from '../support/api';
import { startSignedIn } from '../support/session';

// PID-295: Marcel's welcome shows once per install, after the age gate, before
// the first table and never on one. Settings → Tell us writes to him.
test.use({ welcomeSeen: false });

const sheet = (page: import('@playwright/test').Page) => page.getByTestId('welcome-sheet');

/** Records the URL the app opens instead of handing it to a mail app; `fail` acts as if there is none. */
async function catchOpenedUrls(page: import('@playwright/test').Page, fail = false) {
  await page.addInitScript((fail) => {
    (window as any).__opened = [];
    window.open = (url) => {
      if (fail) throw new Error('no mail app');
      (window as any).__opened.push(String(url));
      return null;
    };
  }, fail);
}
const openedUrls = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).__opened as string[]);

/** Waits long enough for the stored flag to have been read, then says whether the sheet is up. */
async function expectNoSheet(page: import('@playwright/test').Page) {
  await page.waitForTimeout(1_500);
  await expect(sheet(page)).toHaveCount(0);
}

/** At the table, waiting or playing, the sheet stays away; then the player leaves. */
async function sitAtTableThenLeave(page: import('@playwright/test').Page) {
  const ready = page.getByRole('button', { name: "I'm ready", exact: true });
  const settings = page.getByRole('button', { name: 'Table settings', exact: true });
  await expect(ready.or(settings)).toBeVisible({ timeout: 30_000 });
  await expectNoSheet(page);
  if (await ready.isVisible()) await ready.click();
  await expect(settings).toBeVisible({ timeout: 30_000 });
  await expectNoSheet(page);
  await settings.click();
  await page.getByRole('button', { name: 'Leave table', exact: true }).click();
  await page.getByRole('button', { name: 'Leave table', exact: true }).last().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/game'));
}

test.describe('a first launch', () => {
  test.use({ ageAnswered: false });

  test('a fresh guest meets the welcome after the age gate, before the first table, once @responsive', async ({
    page,
  }) => {
    await catchOpenedUrls(page);
    await page.goto('/');
    const age = new AgeScreen(page);
    await expect(age.root).toBeVisible({ timeout: 30_000 });
    await expect(sheet(page)).toHaveCount(0);
    await age.choose('18 or older');
    await age.continueButton.click();

    // On Welcome, before PLAY can start a game.
    await expect(sheet(page)).toBeVisible();
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(sheet(page).getByText('Welcome to the new Pidro', { exact: true })).toBeVisible();
    await expect(sheet(page).getByText('From Marcel', { exact: true })).toBeVisible();
    await expect(
      sheet(page).getByText(
        "This is a test version. You're one of the first to play it, and it's still being built.",
        { exact: true }
      )
    ).toBeVisible();
    await expect(
      sheet(page).getByText('Your old Pidro app keeps working. Nothing there changes.', {
        exact: true,
      })
    ).toBeVisible();

    // The address opens a new mail.
    await sheet(page)
      .getByRole('link', { name: /marcel@pidro\.online/ })
      .click();
    expect((await openedUrls(page))[0]).toMatch(
      /^mailto:marcel@pidro\.online\?subject=Pidro%20beta%20feedback&body=%0D%0A%0D%0AApp%20version/
    );

    await sheet(page).getByRole('button', { name: "Let's play", exact: true }).click();
    await expect(sheet(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('news-seen:welcome'))).toBe('1');

    await page.reload();
    const welcome = new WelcomeWindow(page);
    await expect(welcome.root).toBeVisible({ timeout: 30_000 });
    await expectNoSheet(page);

    await welcome.quickGame.click();
    await page.waitForURL(/\/game\/[A-Z0-9]+/, { timeout: 30_000 });
    await sitAtTableThenLeave(page);
    await expectNoSheet(page);
  });
});

test('a player already signed in, with no flag, meets it once on Home', async ({
  page,
  player,
}) => {
  await startSignedIn(page, await register(player));
  await page.goto('/home');
  await expect(sheet(page)).toBeVisible({ timeout: 30_000 });
  await sheet(page).getByRole('button', { name: "Let's play", exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  // Home is usable again.
  await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
  await expect(page).toHaveURL(/\/settings$/);

  await page.goto('/home');
  await expect(new HomeScreen(page).root).toBeVisible({ timeout: 30_000 });
  await expectNoSheet(page);
});

test('it never covers a table, and shows once the player leaves it', async ({ page, player }) => {
  const session = await guest(player);
  const room = await api('/api/v1/rooms', {
    method: 'POST',
    token: session.token,
    body: { rule_set: 'finnish', seats: { seat_2: 'ai', seat_3: 'ai', seat_4: 'ai' } },
  });
  expect(room.status).toBe(201);
  await startSignedIn(page, session);

  // Straight onto the table, as a relaunch into a game does.
  await page.goto(`/game/${room.payload.data.code}`);
  await sitAtTableThenLeave(page);
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('button', { name: "Let's play", exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
});

test.describe('Tell us', () => {
  test.use({ welcomeSeen: true });

  test('Settings opens the sheet ready to write, with the address to answer at', async ({
    page,
    player,
  }) => {
    await startSignedIn(page, await register(player));
    await page.goto('/settings');
    const row = page.getByTestId('settings-tell');
    await expect(row.getByText('Tell us', { exact: true })).toBeVisible({ timeout: 30_000 });
    await row.click();
    const tell = page.getByTestId('feedback-sheet');
    await expect(tell.getByText("Hey, I'm Marcel.", { exact: true })).toBeVisible();
    // The sheet lands first, then the box takes focus.
    await expect(page.getByTestId('feedback-body')).toBeFocused();
    await expect(tell.getByText(/^We'll answer at \S+@\S+$/)).toBeVisible();
  });

  test.describe('with the server down', () => {
    test.use({ unavailableExpected: true });

    test('when the note does not go through, the mail app gets the words and the details', async ({
      page,
      player,
    }) => {
      const session = await register(player);
      await catchOpenedUrls(page);
      await page.route('**/api/v1/feedback', (route) => route.fulfill({ status: 503, json: {} }));
      await startSignedIn(page, session);
      await page.goto('/home');
      await page.getByRole('button', { name: 'Tell us', exact: true }).click({ timeout: 30_000 });
      await page.getByTestId('feedback-body').fill('The bid buttons are small.');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const tell = page.getByTestId('feedback-sheet');
      await expect(tell.getByText("That didn't go through. Your words are safe.")).toBeVisible();
      await expect(page.getByTestId('feedback-body')).toHaveValue('The bid buttons are small.');
      await tell.getByRole('button', { name: 'Use my mail app', exact: true }).click();

      const [url] = await openedUrls(page);
      const [address, query] = url.split('?');
      expect(address).toBe('mailto:marcel@pidro.online');
      const params = new URLSearchParams(query.replaceAll('+', '%2B'));
      expect(params.get('subject')).toBe('Pidro beta feedback');
      const body = params.get('body')!.split('\r\n');
      expect(body.slice(0, 2)).toEqual(['The bid buttons are small.', '']);
      expect(body.slice(2).map((line) => line.split(':')[0])).toEqual([
        'App version',
        'Native build',
        'Update',
        'Platform',
        'Device',
        'Player',
      ]);
      expect(body).toContain(`Player: ${player.name} (${session.user.id})`);
    });
  });
});
