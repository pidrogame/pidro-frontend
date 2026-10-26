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
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
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
  let holdIdentity = false;
  const identityReads = [];
  await page.route('**/api/v1/profile', async (route) => {
    if (route.request().method() === 'GET' && holdIdentity) {
      // Snapshot at request time, not response time: this read predates the upload.
      const data = structuredClone(identity);
      await new Promise((resolve) => identityReads.push(resolve));
      return route.fulfill({ json: { data } });
    }
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
  const avatarRequests = [];
  let holdAvatar = false;
  let releaseAvatar;
  let failAvatar = false;
  let avatarVersion = 0;
  await page.route('**/api/v1/profile/avatar', async (route) => {
    avatarRequests.push(route.request());
    if (holdAvatar)
      await new Promise((resolve) => {
        releaseAvatar = resolve;
      });
    if (failAvatar)
      return route.fulfill({ status: 503, json: { error: { message: 'Please try again.' } } });
    identity.avatar_url =
      route.request().method() === 'DELETE'
        ? null
        : `${baseURL}/profile-test-avatar-${++avatarVersion}.png`;
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
  const avatarButton = page.getByTestId('profile-avatar-button');
  assert.equal(await avatarButton.getAttribute('aria-label'), 'Your photo and ring');
  const pinOnAvatar = () => avatarButton.locator('svg').count();
  const pinned = await pinOnAvatar();
  await button('Old Pidro · Level 42').click();
  const sheet = page.getByTestId('badge-sheet');
  await visible(sheet.getByText('Old Pidro · Level 42 · 1,284 games as SofiaClassic'));
  const radio = (name) => sheet.getByRole('radio', { name: new RegExp(`^${name}\\.`) });
  assert.equal(await radio('Old Pidro').getAttribute('aria-checked'), 'true');
  assert.equal(await radio('Founding Tester').isDisabled(), true);
  await assertMinimumTouchTargets(page, 'badges', { name: 'portrait' });
  await capture('profile-badges');
  await radio('No pin').click();
  assert.equal(await radio('No pin').getAttribute('aria-checked'), 'true');
  await sheet.getByTestId('badge-done').click();
  await sheet.waitFor({ state: 'hidden' });
  assert.ok((await pinOnAvatar()) < pinned, 'No pin left the Classic pin on the avatar');
  const stored = await page.evaluate(() => localStorage.getItem('settings-storage'));
  assert.equal(
    JSON.parse(stored).state.pins['profile-ui-user'],
    'none',
    'the pin choice was not kept'
  );
  await avatarButton.click();
  await radio('Old Pidro').click();
  await sheet.getByTestId('badge-done').click();
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
  await avatarButton.click();
  await visible(sheet);
  await sheet.getByTestId('badge-done').click();
  await sheet.waitFor({ state: 'hidden' });
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

  // Generate real images without a fixture file or a picker/manipulator mock.
  const makePhoto = async (width, height) => ({
    name: `avatar-${width}x${height}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(
      await page.evaluate(
        ({ width, height }) => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          context.fillStyle = '#386b73';
          context.fillRect(0, 0, width, height);
          context.fillStyle = '#d1aa70';
          context.fillRect(width / 4, height / 4, width / 2, height / 2);
          return canvas.toDataURL('image/png').split(',')[1];
        },
        { width, height }
      ),
      'base64'
    ),
  });
  const smallPhoto = await makePhoto(96, 96);
  const largePhoto = await makePhoto(1600, 1200);
  await page.route('**/profile-test-avatar-*.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: smallPhoto.buffer })
  );
  const fallbackSrc = await avatarButton.locator('img').first().getAttribute('src');
  assert.ok(fallbackSrc, 'the no-photo avatar has a fallback image');
  const persistedAvatar = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('auth-storage')).state.user.avatar_url);
  const assertAvatar = async (locator, url) => {
    const image = locator.locator('img').first();
    await page.waitForFunction(
      ({ testId, src }) =>
        document.querySelector(`[data-testid="${testId}"] img`)?.getAttribute('src') === src,
      { testId: await locator.getAttribute('data-testid'), src: url ?? fallbackSrc }
    );
    assert.equal(await image.getAttribute('src'), url ?? fallbackSrc);
    await image.evaluate((image) => image.decode());
    assert.equal(await persistedAvatar(), url, 'auth persistence agrees with the rendered avatar');
  };
  const openPicker = async (testId = 'photo-change') => {
    const chooser = page.waitForEvent('filechooser');
    await sheet.getByTestId(testId).click();
    const picker = await chooser;
    assert.equal(picker.isMultiple(), false);
    assert.match(await picker.element().getAttribute('accept'), /image\/\*/);
    return picker;
  };
  const assertMultipart = async (request, width, height, type) => {
    assert.equal(request.method(), 'POST');
    const contentType = request.headers()['content-type'];
    assert.match(contentType, /^multipart\/form-data; boundary=/);
    const body = await new Response(request.postDataBuffer(), {
      headers: { 'Content-Type': contentType },
    }).formData();
    assert.deepEqual([...body.keys()], ['avatar'], 'upload contains exactly one avatar part');
    const photo = body.get('avatar');
    assert.equal(photo.type, type);
    assert.ok(photo.size > 0);
    const encoded = Buffer.from(await photo.arrayBuffer()).toString('base64');
    const dimensions = await page.evaluate(
      async ({ encoded, type }) => {
        const image = new Image();
        image.src = `data:${type};base64,${encoded}`;
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      },
      { encoded, type }
    );
    assert.deepEqual(dimensions, [width, height], 'multipart contains the processed image');
    if (type === 'image/png')
      assert.deepEqual(Buffer.from(await photo.arrayBuffer()), smallPhoto.buffer);
  };
  const closeSheet = async () => {
    await sheet.getByTestId('badge-done').click();
    await sheet.waitFor({ state: 'hidden' });
  };
  const checkHomeAvatar = async (url) => {
    await button('Go back').click();
    await visible(button('Open your profile'));
    await assertAvatar(page.getByTestId('home-header'), url);
    await button('Open your profile').click();
    await visible(button('Add bio'));
    await assertAvatar(avatarButton, url);
  };

  await avatarButton.click();
  await visible(sheet.getByRole('button', { name: 'Add photo', exact: true }));
  assert.equal(await sheet.getByTestId('badge-done').getAttribute('role'), 'link');
  assert.equal(await sheet.getByTestId('photo-remove').count(), 0);
  assert.equal(await button('Save photo').count(), 0, 'photos no longer need a Save button');
  await capture('profile-photo-empty');

  // An empty selection exercises Expo's real cancellation path, not a mocked hook.
  await (await openPicker()).setFiles([]);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="photo-change"]')?.getAttribute('aria-disabled') !==
      'true'
  );
  await closeSheet();
  assert.equal(avatarRequests.length, 0, 'canceling the picker sent no upload');
  await assertAvatar(avatarButton, null);

  await avatarButton.click();
  await (
    await openPicker()
  ).setFiles({
    ...smallPhoto,
    buffer: Buffer.concat([smallPhoto.buffer, Buffer.alloc(5 * 1024 * 1024)]),
  });
  await visible(sheet.getByText('That photo is still larger than 5 MB. Choose a smaller image.'));
  assert.equal(avatarRequests.length, 0, 'an oversized photo is not uploaded');
  await (
    await openPicker('photo-retry')
  ).setFiles({
    name: 'unreadable.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not a photo'),
  });
  await visible(
    sheet.getByText(
      'Could not open that photo. Check photo access in Settings or choose another image.'
    )
  );
  assert.equal(avatarRequests.length, 0, 'an unreadable photo is not uploaded');
  await closeSheet();
  await assertAvatar(avatarButton, null);

  // Start an identity read before uploading, and deliver its old avatar afterwards.
  await button('Go back').click();
  await visible(button('Open your profile'));
  identity.username = 'Sofia refreshed';
  holdIdentity = true;
  const delayedRead = page.waitForRequest(
    (request) => request.url().endsWith('/api/v1/profile') && request.method() === 'GET'
  );
  await button('Open your profile').click();
  await delayedRead;
  await avatarButton.click();
  holdAvatar = true;
  const uploading = page.waitForRequest('**/api/v1/profile/avatar');
  await (await openPicker()).setFiles(smallPhoto);
  await assertMultipart(await uploading, 96, 96, 'image/png');
  const progress = sheet.getByRole('progressbar');
  await visible(progress);
  assert.equal(await progress.getAttribute('data-testid'), 'photo-progress');
  const preview = sheet.getByTestId('photo-preview').locator('img').first();
  assert.match(await preview.getAttribute('src'), /^(blob:|data:image\/)/);
  await preview.evaluate((image) => image.decode());
  await assertAvatar(avatarButton, null);
  assert.equal(identity.avatar_url, null, 'the server has not accepted the photo yet');
  assert.equal(await sheet.getByTestId('photo-change').isDisabled(), true);
  assert.equal(await sheet.getByTestId('badge-done').isDisabled(), true);
  for (const viewport of [viewports[0], viewports[2], viewports[3], viewports[5]]) {
    await page.setViewportSize(viewport);
    await capture(`profile-${viewport.name}-photo-uploading`, progress);
    await assertMinimumTouchTargets(page, 'photo sheet', viewport);
    assertInsideViewport('photo progress', await progress.boundingBox(), viewport);
    assertInsideViewport('Done', await sheet.getByTestId('badge-done').boundingBox(), viewport);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('profile-photo-uploading', progress);
  assert.equal(typeof releaseAvatar, 'function');
  holdAvatar = false;
  releaseAvatar();
  const saved = sheet.getByText('Photo saved', { exact: true });
  await visible(saved);
  const savedAt = Date.now();
  const firstAvatar = identity.avatar_url;
  await assertAvatar(avatarButton, firstAvatar);
  assert.equal(await preview.getAttribute('src'), firstAvatar);
  assert.equal(await progress.count(), 0);
  await capture('profile-photo-saved');
  await page.waitForTimeout(650);
  assert.equal(await saved.isVisible(), true, 'saved feedback survives the first second');
  await saved.waitFor({ state: 'hidden', timeout: 2500 });
  const savedDuration = Date.now() - savedAt;
  assert.ok(
    savedDuration >= 1700 && savedDuration <= 3000,
    `Photo saved lasted ${savedDuration}ms`
  );

  assert.ok(identityReads.length > 0, 'an old identity response is actually in flight');
  holdIdentity = false;
  for (const release of identityReads) release();
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('auth-storage')).state.user.username === 'Sofia refreshed'
  );
  await assertAvatar(avatarButton, firstAvatar);
  await closeSheet();
  await checkHomeAvatar(firstAvatar);
  console.log(
    `Photo upload passed: multipart PNG, held preview/progress, persisted profile/home avatars, stale identity read, ${savedDuration}ms saved feedback.`
  );

  // A failed change leaves the previous server photo everywhere; retry opens a new picker.
  await avatarButton.click();
  await visible(sheet.getByRole('button', { name: 'Change photo', exact: true }));
  failAvatar = true;
  await (await openPicker()).setFiles(smallPhoto);
  await visible(sheet.getByRole('alert'));
  await assertAvatar(avatarButton, firstAvatar);
  assert.equal(await preview.getAttribute('src'), firstAvatar);
  await capture('profile-photo-error');
  const requestsBeforeRetry = avatarRequests.length;
  assert.equal(await sheet.getByTestId('photo-retry').getAttribute('role'), 'link');
  await (await openPicker('photo-retry')).setFiles([]);
  await closeSheet();
  assert.equal(avatarRequests.length, requestsBeforeRetry, 'canceling retry sent no request');
  await checkHomeAvatar(firstAvatar);

  // A large image goes through the real Expo manipulator before immediate upload.
  await avatarButton.click();
  failAvatar = false;
  holdAvatar = true;
  releaseAvatar = undefined;
  const resizing = page.waitForRequest('**/api/v1/profile/avatar');
  await (await openPicker()).setFiles(largePhoto);
  await assertMultipart(await resizing, 1024, 768, 'image/jpeg');
  await visible(progress);
  await assertAvatar(avatarButton, firstAvatar);
  assert.notEqual(await preview.getAttribute('src'), firstAvatar);
  assert.equal(typeof releaseAvatar, 'function');
  holdAvatar = false;
  releaseAvatar();
  await visible(saved);
  const resizedAvatar = identity.avatar_url;
  assert.notEqual(resizedAvatar, firstAvatar);
  await assertAvatar(avatarButton, resizedAvatar);
  await closeSheet();
  await checkHomeAvatar(resizedAvatar);

  // Removal is inline, cancel is inert, and errors cannot erase the saved image.
  await avatarButton.click();
  const requestsBeforeRemove = avatarRequests.length;
  assert.equal(await sheet.getByTestId('photo-remove').getAttribute('role'), 'link');
  await sheet.getByTestId('photo-remove').click();
  await visible(sheet.getByTestId('photo-confirm'));
  assert.equal(await sheet.getByTestId('photo-cancel').getAttribute('role'), 'link');
  await capture('profile-photo-remove-confirm');
  await sheet.getByTestId('photo-cancel').click();
  await visible(sheet.getByTestId('photo-change'));
  assert.equal(avatarRequests.length, requestsBeforeRemove, 'canceling removal sent no request');
  await assertAvatar(avatarButton, resizedAvatar);
  failAvatar = true;
  await sheet.getByTestId('photo-remove').click();
  await sheet.getByTestId('photo-confirm').click();
  await visible(sheet.getByRole('alert'));
  assert.equal(avatarRequests.at(-1).method(), 'DELETE');
  assert.equal(identity.avatar_url, resizedAvatar);
  await assertAvatar(avatarButton, resizedAvatar);
  assert.equal(await preview.getAttribute('src'), resizedAvatar);
  await capture('profile-photo-remove-error');
  await closeSheet();
  await checkHomeAvatar(resizedAvatar);
  await avatarButton.click();
  failAvatar = false;
  holdAvatar = true;
  releaseAvatar = undefined;
  const removing = page.waitForRequest('**/api/v1/profile/avatar');
  await sheet.getByTestId('photo-remove').click();
  await sheet.getByTestId('photo-confirm').click();
  assert.equal((await removing).method(), 'DELETE');
  await assertAvatar(avatarButton, resizedAvatar);
  assert.equal(await sheet.getByTestId('badge-done').isDisabled(), true);
  assert.equal(typeof releaseAvatar, 'function');
  holdAvatar = false;
  releaseAvatar();
  await visible(sheet.getByRole('button', { name: 'Add photo', exact: true }));
  await assertAvatar(avatarButton, null);
  assert.equal(await preview.getAttribute('src'), fallbackSrc);
  assert.equal(await sheet.getByTestId('photo-remove').count(), 0);
  await capture('profile-photo-removed');
  await closeSheet();
  await checkHomeAvatar(null);
  assert.deepEqual(
    avatarRequests.map((request) => request.method()),
    ['POST', 'POST', 'POST', 'DELETE', 'DELETE']
  );
  console.log(
    'Photo recovery passed: failed upload, retry picker cancellation, 1600×1200 → 1024×768 JPEG multipart, removal cancel/failure/held success, profile/home fallback.'
  );

  // Browser Back can leave even a guarded native route. Its pending server result
  // still belongs to this session, not to the now-unmounted photo sheet.
  for (const method of ['POST', 'DELETE']) {
    await avatarButton.click();
    holdAvatar = true;
    releaseAvatar = undefined;
    const request = page.waitForRequest('**/api/v1/profile/avatar');
    if (method === 'POST') await (await openPicker()).setFiles(smallPhoto);
    else {
      await sheet.getByTestId('photo-remove').click();
      await sheet.getByTestId('photo-confirm').click();
    }
    assert.equal((await request).method(), method);
    const oldAvatar = identity.avatar_url;
    const homeRead = page.waitForResponse('**/api/v1/profile');
    await page.goBack();
    await visible(button('Open your profile'));
    await homeRead;
    await assertAvatar(page.getByTestId('home-header'), oldAvatar);
    assert.equal(await sheet.count(), 0, 'the pending sheet is actually unmounted');
    assert.equal(typeof releaseAvatar, 'function');
    const completed = page.waitForResponse('**/api/v1/profile/avatar');
    holdAvatar = false;
    releaseAvatar();
    await completed;
    await assertAvatar(page.getByTestId('home-header'), identity.avatar_url);
    await button('Open your profile').click();
    await visible(button('Add bio'));
    await assertAvatar(avatarButton, identity.avatar_url);
  }
  console.log(
    'Photo navigation passed: upload and removal reconcile Home after browser Back unmounts the sheet.'
  );

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
