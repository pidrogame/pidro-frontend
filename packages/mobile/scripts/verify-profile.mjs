import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { assertInsideViewport, assertMinimumTouchTargets } from './ui-test-utils.mjs';

// Exercise the actual Expo profile route with deterministic API responses.
const baseURL = process.env.MOBILE_BASE_URL ?? 'http://localhost:8088';
const shots = process.env.UI_SHOT_DIR;
if (shots) await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const identity = {
    user_id: 'profile-ui-user',
    username: 'Sofia',
    display_name: null,
    avatar_url: null,
    bio: 'Always up for one more hand. Coffee helps. ☕',
    veteran: { level: 44, xp: 158320, title: 'Mainstay', progress: [3320, 7000] },
    xp: { this_week: 1240, this_month: 5880 },
    record: { games: 2076, wins: 1131, losses: 945, win_rate: 1131 / 2076 },
    classic: {
      name: 'SofiaClassic',
      games_played: 1284,
      wins: 702,
      losses: 582,
      win_rate: 702 / 1284,
      level: 42,
      member_since: '2012-04-03T00:00:00Z',
      claimed_at: '2026-09-30T00:00:00Z',
    },
  };
  await page.addInitScript((user) => {
    localStorage.setItem(
      'age-gate-storage',
      JSON.stringify({ state: { ageBand: '18_plus', termsVersion: '1' }, version: 0 })
    );
    localStorage.setItem('news-seen:welcome', '1');
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({
        state: {
          accessToken: 'profile-ui-token',
          refreshToken: null,
          user: {
            ...user,
            id: user.user_id,
            email: 'sofia@example.com',
            age_band: '18_plus',
          },
        },
        version: 0,
      })
    );
  }, identity);
  let failSave = true;
  let releaseSave;
  let holdSave = false;
  await page.route('**/api/v1/profile', async (route) => {
    if (route.request().method() === 'PATCH') {
      if (holdSave)
        await new Promise((resolve) => {
          releaseSave = resolve;
        });
      if (failSave)
        return route.fulfill({ status: 503, json: { error: { message: 'Please try again.' } } });
      identity.bio = route.request().postDataJSON().bio;
    }
    await route.fulfill({ json: { data: identity } });
  });
  await page.route('**/api/v1/profile/avatar', async (route) => {
    identity.avatar_url = route.request().method() === 'DELETE' ? null : `${baseURL}/favicon.ico`;
    await route.fulfill({ json: { data: { avatar_url: identity.avatar_url } } });
  });
  const button = (name) => page.getByRole('button', { name, exact: true });
  const visible = async (locator) => locator.waitFor({ state: 'visible' });
  const capture = async (name, focus) => {
    // Let modal removal and orientation reflow finish before positioning the scroll view.
    await page.waitForTimeout(400);
    if (focus) await focus.scrollIntoViewIfNeeded();
    if (shots) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: resolve(shots, `${name}.png`) });
    }
  };
  await page.goto(baseURL);
  await button('Open your profile').click();
  await visible(button('Edit bio'));
  await visible(page.getByText('Mainstay · Level 44', { exact: true }));
  await visible(page.getByText('3,680 XP to Level 45', { exact: true }));
  for (const label of ['Games played: 2,076', 'Wins: 1,131', 'Win rate: 54%']) {
    await visible(page.getByTestId('profile-record').getByLabel(label, { exact: true }));
  }
  await assertMinimumTouchTargets(page, 'profile', { name: 'portrait' });
  await capture('profile-native-clean');

  // The Classic chip opens the badge sheet; the pin chosen there stays on this device.
  const pinOnAvatar = () =>
    page.getByRole('button', { name: 'Your badges' }).locator('svg').count();
  const pinned = await pinOnAvatar();
  await button('Pidro Classic · Level 42').click();
  const sheet = page.getByTestId('badge-sheet');
  await visible(sheet.getByText('Level 42 in Classic · 1,284 games as SofiaClassic'));
  const radio = (name) => sheet.getByRole('radio', { name: new RegExp(`^${name}\\.`) });
  assert.equal(await radio('Pidro Classic').getAttribute('aria-checked'), 'true');
  assert.equal(await radio('Founding Tester').isDisabled(), true);
  await assertMinimumTouchTargets(page, 'badges', { name: 'portrait' });
  await capture('profile-badges');
  await radio('No pin').click();
  assert.equal(await radio('No pin').getAttribute('aria-checked'), 'true');
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  assert.ok((await pinOnAvatar()) < pinned, 'No pin left the Classic pin on the avatar');
  const stored = await page.evaluate(() => localStorage.getItem('settings-storage'));
  assert.equal(
    JSON.parse(stored).state.pins['profile-ui-user'],
    'none',
    'the pin choice was not kept'
  );
  await button('Your badges').click();
  await radio('Pidro Classic').click();
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });

  const viewports = [
    { name: 'phone-landscape', width: 844, height: 390 },
    { name: 'compact-landscape', width: 667, height: 375 },
    { name: 'ipad-portrait', width: 768, height: 1024 },
    { name: 'ipad-landscape', width: 1024, height: 768 },
    { name: 'ipad-pro-landscape', width: 1366, height: 1024 },
    { name: 'ipad-split-view', width: 507, height: 768 },
  ];
  const checkLayout = async (viewport) => {
    const left = await page.getByTestId('profile-identity-column').boundingBox();
    const right = await page.getByTestId('profile-bio-column').boundingBox();
    if (viewport.width >= 640) {
      assert.ok(Math.abs(left.y - right.y) < 1, `${viewport.name}: columns align at top`);
      assert.ok(right.x >= left.x + left.width + 15, `${viewport.name}: columns cannot overlap`);
    } else {
      assert.ok(right.y >= left.y + left.height, `${viewport.name}: narrow window stacks`);
    }
    assert.ok(right.x + right.width - left.x <= 880, 'Content stays bounded on large iPads');
    await assertMinimumTouchTargets(page, 'profile', viewport);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true
    );
  };
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await capture(`profile-${viewport.name}`);
    await checkLayout(viewport);
    // The columns scroll; they must fit across the window.
    for (const column of ['profile-identity-column', 'profile-bio-column']) {
      const box = await page.getByTestId(column).boundingBox();
      assert.ok(
        box.x >= 0 && box.x + box.width <= viewport.width,
        `${column} fits ${viewport.name}`
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await button('Edit bio').click();
  const input = page.getByRole('textbox', { name: 'About me' });
  assert.equal(await button('Save bio').isDisabled(), true);
  await input.fill('Friends, cards, and a little Finnish sisu.');
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await capture(`profile-${viewport.name}-editing`, button('Save bio'));
    await checkLayout(viewport);
    assert.equal(await input.inputValue(), 'Friends, cards, and a little Finnish sisu.');
    for (const name of ['Cancel', 'Save bio']) {
      assertInsideViewport(name, await button(name).boundingBox(), viewport);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await button('Edit photo').click();
  await button('Keep editing').click();
  assert.equal(await input.inputValue(), 'Friends, cards, and a little Finnish sisu.');
  await page.setViewportSize({ width: 844, height: 390 });
  assert.equal(await input.inputValue(), 'Friends, cards, and a little Finnish sisu.');
  await button('Save bio').scrollIntoViewIfNeeded();
  await assertMinimumTouchTargets(page, 'profile', { name: 'landscape' });
  await capture('profile-native-landscape-edit', button('Save bio'));
  for (const name of ['Cancel', 'Save bio']) {
    assertInsideViewport(name, await button(name).boundingBox(), {
      name: 'landscape',
      width: 844,
      height: 390,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill('x'.repeat(281));
  assert.equal(await button('Save bio').isDisabled(), true);
  await input.fill('Friends, cards, and a little Finnish sisu.');
  await button('Save bio').click();
  await visible(page.getByRole('alert'));
  assert.equal(await input.inputValue(), 'Friends, cards, and a little Finnish sisu.');
  await capture('profile-native-retry');
  failSave = false;
  holdSave = true;
  await button('Save bio').click();
  await button('Go back').click();
  await visible(page.getByText('Please wait', { exact: true }));
  await button('OK').click();
  assert.equal(typeof releaseSave, 'function');
  releaseSave();
  await visible(page.getByText('About me saved.', { exact: true }));
  holdSave = false;
  await button('Edit bio').click();
  await input.fill('Do not lose this draft.');
  await button('Go back').click();
  await button('Keep editing').click();
  assert.equal(await input.inputValue(), 'Do not lose this draft.');
  await button('Go back').click();
  await button('Discard changes').click();
  await visible(button('Open your profile'));
  await button('Open your profile').click();
  await button('Edit bio').click();
  await input.fill('');
  await button('Save bio').click();
  await visible(button('Add bio'));
  await capture('profile-native-empty');

  await button('Edit photo').click();
  const chooser = page.waitForEvent('filechooser');
  await button('Choose photo').click();
  await (
    await chooser
  ).setFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=',
      'base64'
    ),
  });
  await visible(button('Save photo'));
  for (const viewport of [viewports[0], viewports[2], viewports[3], viewports[5]]) {
    await page.setViewportSize(viewport);
    await capture(`profile-${viewport.name}-photo`, button('Save photo'));
    await checkLayout(viewport);
    assertInsideViewport('Save photo', await button('Save photo').boundingBox(), viewport);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await button('Add bio').click();
  await button('Keep editing').click();
  await visible(button('Save photo'));
  await button('Cancel').click();
  assert.equal(identity.avatar_url, null);
  await button('Edit photo').click();
  await capture('profile-native-photo-edit');
  await button('Done').click();
  // Sign out lives in Settings. Leaving with a draft asks first, as Back does.
  await button('Add bio').click();
  await input.fill('Unsaved sign-out draft.');
  await button('Account and sign-in').click();
  await button('Keep editing').click();
  assert.equal(await input.inputValue(), 'Unsaved sign-out draft.');
  await button('Account and sign-in').click();
  await button('Discard changes').click();
  await page.waitForURL(/\/settings$/);
  await visible(page.getByText('sofia@example.com', { exact: true }));
  await button('Sign out').click();
  await visible(page.getByText('Sign out?', { exact: true }));
  await button('Cancel').click();
  await button('Sign out').click();
  await button('Sign out').last().click();
  await page.waitForURL(/\/welcome$/);
  assert.equal(await page.evaluate(() => localStorage.getItem('auth-storage')), null);
  assert.deepEqual(errors, []);
  console.log(
    'Profile UI passed: phone portrait/landscape, compact landscape, iPad portrait/landscape/Pro/split view, record and XP, badge sheet and pin choice, preserved drafts, bounded columns, 44pt targets, validation, retry, navigation guards and sign-out through Settings.'
  );
} finally {
  await browser.close();
}
