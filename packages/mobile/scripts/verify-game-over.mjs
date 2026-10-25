import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  assertInsideViewport,
  assertMinimumTouchTargets,
  suppressDevOverlays,
} from './ui-test-utils.mjs';

const baseUrl = process.env.MOBILE_BASE_URL ?? 'http://localhost:8081';
const shots = process.env.UI_SHOT_DIR ?? '/tmp/pidro-game-over';
const sizes = [
  {
    name: 'phone-portrait',
    width: 390,
    height: 844,
    safeArea: 'island',
    left: 0,
    right: 0,
    top: 59,
    bottom: 34,
  },
  {
    name: 'phone-landscape-left',
    width: 844,
    height: 390,
    safeArea: 'island-left',
    left: 59,
    right: 0,
    top: 0,
    bottom: 21,
  },
  {
    name: 'phone-landscape-right',
    width: 844,
    height: 390,
    safeArea: 'island-right',
    left: 0,
    right: 59,
    top: 0,
    bottom: 21,
  },
  { name: 'small-phone', width: 320, height: 568, top: 0, left: 0, right: 0, bottom: 0 },
  { name: 'small-landscape', width: 667, height: 375, top: 0, left: 0, right: 0, bottom: 0 },
  { name: 'tablet-portrait', width: 834, height: 1194, top: 0, left: 0, right: 0, bottom: 0 },
  { name: 'tablet-landscape', width: 1194, height: 834, top: 0, left: 0, right: 0, bottom: 0 },
];
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
let checks = 0;

async function open(page, params = {}, waitForTable = true) {
  await page.goto(`${baseUrl}/table-dev?${new URLSearchParams({ phase: 'game_over', ...params })}`);
  await page.getByTestId('game-over-window').waitFor();
  await suppressDevOverlays(page);
  await page.evaluate(() => document.fonts.ready);
  if (waitForTable) await page.getByTestId('seat-north').waitFor();
}

async function geometry(page, size) {
  const inside = (id, box) => {
    assertInsideViewport(id, box, size);
    assert.ok(
      box.x >= size.left - 1 && box.x + box.width <= size.width - size.right + 1,
      `${id} clears side insets in ${size.name}`
    );
    assert.ok(
      box.y >= size.top - 1 && box.y + box.height <= size.height - size.bottom + 1,
      `${id} clears top/bottom insets in ${size.name}`
    );
  };
  const blocks = [];
  for (const id of [
    'best-hand',
    'how-it-went',
    'streak-chip',
    'xp-chip',
    'rematch-status',
    'play-again',
    'game-over-home',
  ]) {
    const target = page.getByTestId(id);
    if (!(await target.count())) continue;
    const box = await target.boundingBox();
    assert.ok(box, `${id} has geometry`);
    inside(id, box);
    blocks.push([id, box]);
  }
  for (const [i, [a, boxA]] of blocks.entries()) {
    for (const [b, boxB] of blocks.slice(i + 1)) {
      assert.ok(
        boxA.x + boxA.width <= boxB.x + 1 ||
          boxB.x + boxB.width <= boxA.x + 1 ||
          boxA.y + boxA.height <= boxB.y + 1 ||
          boxB.y + boxB.height <= boxA.y + 1,
        `${a} overlaps ${b} in ${size.name}`
      );
    }
  }
  // Nothing scrolls: every line of text is on screen, inside the safe area.
  for (const text of await page.getByTestId('game-over-window').locator('[dir="auto"]').all()) {
    const box = await text.boundingBox();
    if (box) inside(`"${await text.textContent()}"`, box);
  }
  await assertMinimumTouchTargets(page, 'game-over', size);
}

try {
  const context = await browser.newContext({ reducedMotion: 'reduce', deviceScaleFactor: 2 });
  // Home is protected; use the same inert auth fixture as the UI grammar suite.
  await context.addInitScript(() => {
    localStorage.setItem(
      'age-gate-storage',
      JSON.stringify({ state: { ageBand: '18_plus', termsVersion: '1' }, version: 0 })
    );
    localStorage.setItem(
      'auth-storage',
      JSON.stringify({
        state: {
          accessToken: 'ui-grammar-token',
          refreshToken: null,
          user: { id: 'ui-grammar-user', username: 'Player', age_band: '18_plus' },
        },
        version: 0,
      })
    );
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    await page.goto(`${baseUrl}/table-dev?deal=hand&end=game-over`);
    await page.getByTestId('game-over-window').waitFor();
    assert.equal(await page.getByTestId('result-score-first').textContent(), '62');
    assert.equal(
      await page.getByTestId('hand-result').count(),
      0,
      'final hand has no hidden celebration'
    );
    assert.equal(
      await page.getByTestId('victory-rays').count(),
      reducedMotion === 'reduce' ? 0 : 1
    );
    checks++;
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    const inset = size.safeArea ? { safeArea: size.safeArea } : {};
    await open(page, inset);
    await page.getByRole('heading', { name: 'You and Nora win', exact: true }).waitFor();
    assert.equal(await page.getByTestId('result-score-first').textContent(), '62');
    assert.equal(await page.getByTestId('result-score-second').textContent(), '29');
    assert.equal(
      await page.getByTestId('victory-confetti').count(),
      0,
      'Reduced motion omits confetti'
    );
    assert.equal(await page.getByTestId('victory-rays').count(), 0, 'Reduced motion omits rays');
    assert.equal(await page.getByText(/XP/).count(), 0, 'Absent rewards leave no placeholder');
    await page.getByTestId('how-it-went').waitFor();
    assert.equal(await page.getByTestId('best-hand').count(), 0, 'A win opens on the win');
    await geometry(page, size);
    await page.screenshot({ path: resolve(shots, `${size.name}.png`) });
    await page.getByRole('button', { name: 'Rematch', exact: true }).click();
    await page
      .getByTestId('rematch-status')
      .getByText("You're in. Waiting for Nora, Eli and Wynn", { exact: true })
      .waitFor();
    assert.equal(await page.getByTestId('play-again').isDisabled(), true);
    assert.equal(await page.getByTestId('play-again').getAttribute('aria-label'), 'Waiting…');
    await geometry(page, size);
    checks++;

    await open(page, {
      ...inset,
      result: 'loss',
      xp: 'level',
      rematch: 'asked',
      playerName: 'Alexandria the Long-Named Player',
    });
    await page.getByRole('heading', { name: 'Eli and Wynn win', exact: true }).waitFor();
    assert.equal(await page.getByTestId('result-score-first').textContent(), '29');
    assert.equal(await page.getByTestId('result-score-second').textContent(), '62');
    await page.getByTestId('best-hand').getByText('Won 12 of 14', { exact: true }).waitFor();
    await page.getByText('+76 XP · Level 12!', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('streak-chip').count(), 0, 'A loss has no streak');
    await page.getByText('Waiting for you', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('play-again').isEnabled(), true);
    await geometry(page, size);
    await page.screenshot({ path: resolve(shots, `${size.name}-loss-xp.png`) });
    checks++;
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { result: 'east', xp: 'earned' });
  await page.getByRole('heading', { name: 'You and Wynn win', exact: true }).waitFor();
  assert.equal(await page.getByTestId('result-score-first').textContent(), '62');
  assert.equal(await page.getByTestId('result-score-second').textContent(), '29');
  await page.getByText('3 in a row with Nora', { exact: true }).waitFor();
  checks++;

  await open(page, { result: 'spectator', xp: 'level', rematch: 'asked' });
  await page.getByRole('heading', { name: 'Alex and Nora win', exact: true }).waitFor();
  assert.equal(await page.getByTestId('play-again').count(), 0);
  assert.equal(await page.getByTestId('rematch-status').count(), 0);
  assert.equal(await page.getByText(/XP/).count(), 0);
  await page.getByTestId('how-it-went').waitFor();
  await page.screenshot({ path: resolve(shots, 'spectator.png') });
  checks++;

  await open(page, { result: 'tie' });
  await page.getByRole('heading', { name: 'A tie!', exact: true }).waitFor();
  for (const id of ['result-score-first', 'result-score-second']) {
    assert.equal(await page.getByTestId(id).textContent(), '62');
  }
  await page.screenshot({ path: resolve(shots, 'tie.png') });
  checks++;

  for (const rematch of ['missing', 'pending']) {
    await open(page, { rematch });
    assert.equal(await page.getByTestId('play-again').isDisabled(), true);
    assert.equal(
      await page.getByTestId('play-again').getByRole('progressbar').count(),
      rematch === 'pending' ? 1 : 0
    );
    await page.screenshot({ path: resolve(shots, `${rematch}.png`) });
    checks++;
  }
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.waitForURL('**/home');
  assert.deepEqual(errors, []);
  await context.close();

  const motion = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    reducedMotion: 'no-preference',
  });
  const animatedPage = await motion.newPage();
  await open(animatedPage, {}, false);
  const confetti = animatedPage.getByTestId('victory-confetti');
  await confetti.waitFor();
  await animatedPage.getByTestId('victory-rays').waitFor();
  const piece = confetti.locator(':scope > div').first();
  const before = await piece.evaluate((node) => getComputedStyle(node).transform);
  // The suits fall once the score lands, about a second in.
  await animatedPage.waitForTimeout(1500);
  const after = await piece.evaluate((node) => getComputedStyle(node).transform);
  assert.notEqual(after, before, 'Confetti must actually move');
  assert.equal(await confetti.evaluate((node) => getComputedStyle(node).pointerEvents), 'none');
  await animatedPage.screenshot({ path: resolve(shots, 'confetti.png') });
  // A vote rerender must not restart the celebration.
  await animatedPage.getByRole('button', { name: 'Rematch', exact: true }).click();
  await confetti.waitFor({ state: 'detached', timeout: 5000 });
  await animatedPage.setViewportSize({ width: 844, height: 390 });
  assert.equal(await confetti.count(), 0, 'Rotation must not replay confetti');
  await open(animatedPage, { result: 'loss' });
  assert.equal(await confetti.count(), 0, 'Loss must not celebrate');
  assert.equal(await animatedPage.getByTestId('victory-rays').count(), 0, 'A loss has no rays');
  await motion.close();
  checks++;
  console.log(
    `PASS: ${checks} game-over checks; seven viewport/inset combinations, voting, rewards, teams, Home, and motion.`
  );
} finally {
  await browser.close();
}
