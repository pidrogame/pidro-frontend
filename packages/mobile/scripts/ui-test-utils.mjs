import assert from 'node:assert/strict';

// What the UI run looks through (PID-514): every case on a 390×844 phone; the table,
// the first screens and sign-in also on the smallest phone, landscape and the iPad.
// The table also on the iPad held sideways, and on an iPhone held sideways with its
// camera cutout, where East's and West's cards must stay out from under it.
export const UI_VIEWPORTS = [
  { name: 'portrait', width: 390, height: 844 },
  { name: 'compact-portrait', width: 360, height: 640 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  {
    name: 'iphone-insets-landscape',
    width: 874,
    height: 402,
    safeArea: 'iphone-17-landscape',
    insets: { left: 62, right: 62 },
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

// Account copy must fit without scrolling, including text clipped by an ancestor.
// Pass only the pill for Profile: the surrounding profile intentionally scrolls.
export async function assertAccountSurfaceFits(surface, name, viewport) {
  const result = await surface.evaluate((root) => {
    const elements = [root, ...root.querySelectorAll('*')];
    const visible = (el) => {
      const box = el.getBoundingClientRect();
      return box.width && box.height && getComputedStyle(el).visibility !== 'hidden';
    };
    const overflow = elements.filter(visible).filter((el) => {
      const style = getComputedStyle(el);
      return (
        (['auto', 'scroll'].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 2) ||
        (['auto', 'scroll'].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 2)
      );
    });
    const content = elements
      .filter((el) =>
        el.matches('[dir="auto"], [role="button"], [role="link"], [role="radio"], input, textarea')
      )
      .filter(visible);
    const clipped = content.filter((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (
        el.matches('[dir="auto"]') &&
        el.clientWidth &&
        ((['hidden', 'clip'].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1) ||
          (['hidden', 'clip'].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 1))
      )
        return true;
      for (
        let parent = el.parentElement;
        parent && root.contains(parent);
        parent = parent.parentElement
      ) {
        const bounds = parent.getBoundingClientRect();
        const style = getComputedStyle(parent);
        if (
          (style.overflowX !== 'visible' &&
            (box.left < bounds.left - 1 || box.right > bounds.right + 1)) ||
          (style.overflowY !== 'visible' &&
            (box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1))
        )
          return true;
      }
      const bounds = root.getBoundingClientRect();
      return (
        box.left < bounds.left - 1 ||
        box.right > bounds.right + 1 ||
        box.top < bounds.top - 1 ||
        box.bottom > bounds.bottom + 1
      );
    });
    return {
      overflow: overflow.map((el) => el.getAttribute('data-testid') ?? el.tagName),
      clipped: clipped.map((el) => el.textContent || el.getAttribute('aria-label')),
      boxes: content.map((el) => ({
        ...el.getBoundingClientRect().toJSON(),
        text: el.textContent,
      })),
    };
  });
  assert.deepEqual(result.overflow, [], `${name}: no scrolling in ${viewport.name}`);
  assert.deepEqual(result.clipped, [], `${name}: no clipped copy in ${viewport.name}`);
  for (const box of result.boxes) assertInsideViewport(`${name}: ${box.text}`, box, viewport);
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
  // The table's cards move on the canvas, not as CSS animations: wait until they
  // have stood still for 400ms (a deal, a hand sorting under its new trump, whose
  // mark pops meanwhile). A card that never settles leaves it to the 5s limit.
  await page
    .waitForFunction(
      () => {
        const read = globalThis.__pidroCardMotion;
        if (!read) return true;
        const now = JSON.stringify(
          read().map((s) => [
            s.key,
            Math.round(s.x),
            Math.round(s.y),
            s.rotation.toFixed(3),
            s.opacity.toFixed(2),
          ])
        );
        const still = globalThis.__pidroStill;
        if (still?.cards !== now)
          globalThis.__pidroStill = { cards: now, since: performance.now() };
        return still?.cards === now && performance.now() - still.since >= 400;
      },
      undefined,
      { timeout: 5000, polling: 100 }
    )
    .catch(() => {});
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
