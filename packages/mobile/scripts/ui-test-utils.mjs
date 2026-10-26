import assert from 'node:assert/strict';

const seatRowCases = ['setup', 'setup-open', 'opened', 'opened-more'].map(
  (fixture) => `ui-seat-rows-${fixture}`
);
const seatPickerCases = ['choices', 'friends', 'many', 'empty', 'sv'].map(
  (fixture) => `ui-seat-picker-${fixture}`
);
const friendNoticeCases = [
  'request',
  'accepted',
  'linked',
  'seat',
  'offline',
  'queue',
  'too-late',
].map((kind) => `friend-notice-${kind}`);
const friendSheetCases = [
  'partner',
  'opponent',
  'full',
  'online',
  'bots',
  'offline',
  'request',
  'remove',
  'block',
].map((state) => `friends-sheet-${state}`);

const lobbyCases = [
  'list',
  'badges',
  'locked',
  'empty',
  'rejoin',
  'open',
  'substitute',
  'watch',
  'search-empty',
].map((fixture) => `lobby-${fixture}`);

const passwordCases = [
  'password',
  'password-keypad',
  'password-typed',
  'password-wrong',
  'password-wait',
].map((fixture) => `lobby-${fixture}`);

const appUpdateCases = ['en', 'sv'].flatMap((locale) =>
  ['named', 'embedded', 'fallback'].map((fixture) => `locale-${locale}-settings-update-${fixture}`)
);

const backgroundCases = [
  ...['android-gesture', 'android-buttons'].flatMap((mode) =>
    ['home', 'profile', 'table', 'hand-log'].map((screen) => `edge-${screen}-${mode}`)
  ),
  'game-joining',
  'game-restoring',
  'game-loading',
];

const classicClaimCases = [
  'classic-method',
  'classic-login',
  'classic-preview',
  'classic-fresh',
  'classic-guest',
  'classic-password',
  'classic-password-guest',
  'classic-rename',
  'classic-rename-fresh',
  'classic-conflict',
  'classic-conflict-fresh',
  'classic-conflict-guest',
  'classic-conflict-guest-apple',
  'classic-forgot',
  'classic-code',
  'classic-code-invalid',
  ...['method', 'login', 'preview', 'password', 'rename', 'already-claimed'].map(
    (fixture) => `locale-sv-classic-${fixture}`
  ),
  ...['en', 'sv'].flatMap((locale) =>
    ['details', 'rename-details', 'taken'].map((fixture) => `classic-${fixture}-${locale}`)
  ),
];

export const UI_VIEWPORTS = [
  {
    name: 'iphone-insets-portrait',
    width: 402,
    height: 874,
    safeArea: 'iphone-17-portrait',
    cases: ['locale-en-trump', 'locale-sv-trump'],
  },
  {
    name: 'iphone-insets-landscape',
    width: 874,
    height: 402,
    safeArea: 'iphone-17-landscape',
    cases: ['locale-en-settings-system', 'locale-sv-settings-system', 'locale-sv-settings-sv'],
  },
  { name: 'portrait', width: 390, height: 844 },
  // The smallest phone testers hold upright (iPhone SE).
  {
    name: 'small-portrait',
    width: 375,
    height: 667,
    cases: [
      ...backgroundCases,
      ...classicClaimCases,
      'table-play-right',
      'table-play-left',
      'table-play-middle',
      ...['north', 'east', 'south', 'west', 'reduced'].map((winner) => `table-motion-${winner}`),
      'friends-all',
      'friends-classic',
      'friends-link-profile',
      'friends-empty',
      'friends-recent',
      'friends-results',
      'update-notice',
      'update-notice-friends-guest',
      ...appUpdateCases,
      'table-hand-made',
      'table-hand-set',
      'table-hand-they-set',
      'table-game-over',
      'table-game-over-loss',
      'table-game-over-spectator',
      'table-count-help',
      'locale-sv-table-count-help',
      'table-fold',
      'table-fold-legacy',
      'table-fold-reduced',
      'table-fold-trick',
      'table-fold-trick-self',
      'table-takes-the-rest',
      'table-invitation',
      'table-invitation-bidding',
      ...seatRowCases,
      ...passwordCases,
      ...seatPickerCases,
      ...friendNoticeCases,
      ...friendSheetCases,
      'table-game-over-guest-win',
      'table-game-over-guest-loss',
      'table-game-over-online-win',
      'table-game-over-online-loss-in',
      'table-game-over-online-loss',
    ],
  },
  {
    name: 'compact-portrait',
    width: 360,
    height: 640,
    cases: [
      'welcome',
      'welcome-guest',
      'update-notice',
      'table-bid-round',
      'table-bid-high',
      'table-count-help',
      'table-last-trick',
      'table-takes-the-rest',
      'locale-sv-table-count-help',
      'locale-sv-table-takes-the-rest',
    ],
  },
  { name: 'landscape', width: 844, height: 390 },
  {
    // The smallest landscape phone testers hold (Galaxy A5).
    name: 'small-landscape',
    width: 640,
    height: 360,
    cases: [
      'table-bidding',
      'table-playing',
      'table-completed-trick',
      'table-trick-pidro',
      'table-trick-pidro-theirs',
      'table-trick-points',
      'table-trick-points-theirs',
      'table-count-help',
      'table-bot-plays',
      'table-invitation',
      'table-long-names',
      'table-long-names-inset',
    ],
  },
  {
    name: 'compact-landscape',
    width: 667,
    height: 375,
    tableOnly: true,
    entryCases: [
      'welcome',
      'welcome-guest',
      'home',
      'home-guest',
      'update-notice',
      'update-notice-home-guest',
    ],
  },
  {
    name: 'tablet-portrait',
    width: 768,
    height: 1024,
    cases: [
      ...classicClaimCases,
      'table-play-right',
      'table-play-left',
      'table-play-middle',
      ...['north', 'east', 'south', 'west', 'reduced'].map((winner) => `table-motion-${winner}`),
      ...seatPickerCases,
      'friends-all',
      'friends-classic',
      'friends-link-profile',
      'friends-empty',
      'friends-recent',
      'friends-results',
      'ui-components',
      ...appUpdateCases,
      'table-bidding',
      'table-invitation',
      'table-invitation-bidding',
      'table-count-help',
      'table-fold',
      'table-fold-legacy',
      'table-fold-reduced',
      'table-fold-trick',
      'table-fold-trick-self',
      'table-takes-the-rest',
      'update-notice',
      'table-hand-made',
      'table-hand-set',
      'table-hand-they-set',
      'table-game-over',
      'table-game-over-loss',
      'table-game-over-guest-win',
      'table-game-over-guest-loss',
      'table-game-over-online-win',
      'table-game-over-online-loss-in',
      'table-game-over-online-loss',
      ...friendNoticeCases,
      ...friendSheetCases,
    ],
  },
  {
    name: 'home-tablet-portrait',
    width: 820,
    height: 1180,
    lobbyViewport: { name: 'lobby-tablet-portrait', width: 834, height: 1194 },
    cases: [
      ...backgroundCases,
      'welcome',
      'home',
      'home-guest',
      'update-notice',
      'login',
      'register',
      'register-name',
      'classic-forgot',
      'classic-code',
      'classic-code-invalid',
      'classic-help',
      ...lobbyCases,
      ...passwordCases,
      'create-table',
      ...seatRowCases,
    ],
  },
  {
    name: 'tablet-landscape',
    width: 1024,
    height: 768,
    lobbyViewport: { name: 'lobby-tablet-landscape', width: 1194, height: 834 },
    cases: [
      ...seatPickerCases,
      'table-bidding',
      'table-count-help',
      'table-game-over',
      'table-game-over-loss',
      'table-game-over-guest-win',
      'table-game-over-guest-loss',
      'table-game-over-online-win',
      'table-game-over-online-loss-in',
      'table-game-over-online-loss',
      'welcome',
      'home',
      'home-guest',
      'update-notice',
      ...lobbyCases,
      'create-table',
    ],
  },
];

export function assertInsideViewport(name, box, viewport) {
  const tolerance = 1;
  if (
    box.x < -tolerance ||
    box.y < -tolerance ||
    box.x + box.width > viewport.width + tolerance ||
    box.y + box.height > viewport.height + tolerance
  ) {
    throw new Error(
      `${name} is outside ${viewport.name}: ${JSON.stringify(box)} vs ${viewport.width}x${viewport.height}`
    );
  }
}

// Expo's dev-mode error toast (e.g. a failed lobby fetch when no backend is
// running, as in CI) renders real <button> elements that the touch-target and
// geometry assertions would otherwise flag — Playwright role queries pierce
// its shadow root. It is tooling, not app UI: hide its #error-toast host
// (display:none on the host hides the whole shadow tree, including toasts
// that arrive later).
export async function suppressDevOverlays(page) {
  await page.addStyleTag({
    content: '#error-toast { display: none !important; }',
  });
}

// React Native Web paints an Image's source while it is still loading, so a
// full-screen background (bg.png) fills top-down as its bytes arrive. Wait
// until every image has loaded and decoded before a capture.
export async function waitForImages(page) {
  await page.waitForFunction(() => [...document.images].every((img) => img.complete));
  await page.evaluate(() =>
    Promise.all([...document.images].map((img) => img.decode().catch(() => {})))
  );
}

// RN Web modals use finite CSS animations, including delayed ones. Wait for
// their actual end without stopping the application's ambient animation loops.
// Skia/Reanimated canvas motion has a separate settling window in its caller.
export async function waitForScreenshotReady(page) {
  await page.evaluate(() => document.fonts.ready);
  await waitForImages(page);
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          (animation) =>
            animation.effect?.getComputedTiming().iterations === Infinity ||
            (!animation.pending && animation.playState !== 'running')
        ),
    undefined,
    { timeout: 5000 }
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
}

export async function getStableBox(locator, page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const box = await locator.boundingBox();
    if (box) return box;
    await page.waitForTimeout(150);
  }
  return null;
}

// Layout lands on fractional pixels far down a long page (43.9998 for a 44pt button).
const MIN_TARGET = 44 - 0.01;

export async function assertMinimumTouchTargets(
  page,
  screenName,
  viewport,
  { checkInputs = false } = {}
) {
  for (const role of ['button', 'link', 'switch', 'radio']) {
    // Live controls can disappear between isVisible and boundingBox. Measure one
    // DOM snapshot so an earlier nth locator cannot point past the new list.
    const controls = await page.getByRole(role).evaluateAll((nodes) =>
      nodes.flatMap((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (
          rect.width === 0 ||
          rect.height === 0 ||
          style.visibility === 'hidden' ||
          style.display === 'none'
        )
          return [];
        return [
          {
            box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            label: node.getAttribute('aria-label') ?? node.textContent?.trim(),
          },
        ];
      })
    );
    for (const [index, { box, label }] of controls.entries()) {
      if (box.width >= MIN_TARGET && box.height >= MIN_TARGET) continue;
      throw new Error(
        `${screenName} has a sub-44pt ${role} in ${viewport.name}: ${label || index} ${JSON.stringify(box)}`
      );
    }
  }

  if (!checkInputs) return;

  const inputs = await page.locator('input:not([type="checkbox"])').all();
  for (let index = 0; index < inputs.length; index += 1) {
    if (!(await inputs[index].isVisible())) continue;
    const box = await inputs[index].boundingBox();
    if (box && box.height < MIN_TARGET) {
      throw new Error(
        `${screenName} has a sub-44pt input in ${viewport.name}: ${JSON.stringify(box)}`
      );
    }
  }
}

// New table's four seat rows: one centred list upright (436 on a phone, 660 on an
// iPad), two teams side by side sideways. Every row on screen, nothing scrolls.
export async function assertTeamLayout(page, viewport, label) {
  const boxes = [];
  for (const position of ['north', 'south', 'east', 'west']) {
    const box = await page.getByTestId(`new-table-seat-${position}`).boundingBox();
    assert.ok(box, `${label}: ${position} row`);
    assertInsideViewport(`${label} ${position}`, box, viewport);
    boxes.push(box);
  }
  // Judge the layout boxes, not scrollHeight: a notice's slide (or a finished one's
  // leftover copy) is a transform that must not count as overflow.
  const fits = (sizes) =>
    sizes.every(([w, h, clientW, clientH]) => w <= clientW + 1 && h <= clientH + 1);
  let sizes = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    sizes = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[data-testid="new-table-screen"], [data-testid="waiting-table"]'
        ),
      ].map((screen) => {
        const scrolls = ['auto', 'scroll'].includes(getComputedStyle(screen).overflowY);
        const box = scrolls ? screen.firstElementChild : screen;
        const style = getComputedStyle(box);
        const children = [...box.children];
        return [
          Math.max(...children.map((child) => child.offsetLeft + child.offsetWidth)) +
            parseFloat(style.paddingRight),
          Math.max(...children.map((child) => child.offsetTop + child.offsetHeight)) +
            parseFloat(style.paddingBottom),
          screen.clientWidth,
          screen.clientHeight,
        ];
      })
    );
    if (sizes.length && fits(sizes)) break;
    await page.waitForTimeout(100);
  }
  assert.ok(
    sizes.length && fits(sizes),
    `${label}: the screen does not scroll ${JSON.stringify(sizes)}`
  );
  const centre = (box) => box.x + box.width / 2;
  if (viewport.width > viewport.height) {
    boxes.sort((a, b) => a.x - b.x || a.y - b.y);
    const [left, right] = [boxes.slice(0, 2), boxes.slice(2)];
    for (const column of [left, right]) {
      assert.ok(Math.abs(column[0].x - column[1].x) <= 1, `${label}: a team is one column`);
      assert.ok(column[1].y >= column[0].y + column[0].height - 1, `${label}: rows apart`);
    }
    assert.ok(left[0].x + left[0].width < right[0].x, `${label}: teams side by side`);
    assert.ok(Math.abs(left[0].y - right[0].y) <= 1, `${label}: teams level`);
    assert.ok(Math.abs(left[0].width - right[0].width) <= 1, `${label}: equal columns`);
    return 'columns';
  }
  const maxWidth = Math.min(viewport.width, viewport.height) >= 600 ? 660 : 436;
  boxes.sort((a, b) => a.y - b.y);
  for (const [index, box] of boxes.entries()) {
    assert.ok(box.width > 100 && box.width <= maxWidth + 1, `${label}: column width`);
    assert.ok(Math.abs(centre(box) - viewport.width / 2) <= 2, `${label}: centred list`);
    if (index) assert.ok(box.y >= boxes[index - 1].y + boxes[index - 1].height - 1, 'one list');
  }
  return 'list';
}
