import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  assertInsideViewport,
  assertMinimumTouchTargets,
  suppressDevOverlays,
} from './ui-test-utils.mjs';

const base = process.env.MOBILE_BASE_URL ?? 'http://localhost:8081';
const shots = process.env.UI_SHOT_DIR ?? '/tmp/pidro-table-chrome';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch();
try {
  for (const viewport of [
    { name: 'small', width: 320, height: 568, safeArea: 'none', left: 0, right: 0, top: 0 },
    { name: 'portrait', width: 390, height: 844, safeArea: 'island', left: 0, right: 0, top: 59 },
    { name: 'landscape', width: 667, height: 375, safeArea: 'none', left: 0, right: 0, top: 0 },
    {
      name: 'notch-left',
      width: 844,
      height: 390,
      safeArea: 'island-left',
      left: 59,
      right: 0,
      top: 0,
    },
    {
      name: 'notch-right',
      width: 844,
      height: 390,
      safeArea: 'island-right',
      left: 0,
      right: 59,
      top: 0,
    },
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    await page.goto(`${base}/table-dev?phase=playing&safeArea=${viewport.safeArea}&scores=history`);
    const score = page.getByRole('button', { name: 'US 48, THEM 29. Every hand.' });
    await score.waitFor();
    await suppressDevOverlays(page);
    const settings = page.getByRole('button', { name: 'Table settings', exact: true });
    const scoreBox = await score.boundingBox();
    const settingsBox = await settings.boundingBox();
    assertInsideViewport('score', scoreBox, viewport);
    assertInsideViewport('settings', settingsBox, viewport);
    // Below a notch or island the header row sits on the safe inset (the game
    // hides the status bar); with no top inset it keeps 8pt from the edge.
    assert(scoreBox.x >= viewport.left + 8 && scoreBox.y >= (viewport.top || 8));
    assert(settingsBox.x + settingsBox.width <= viewport.width - viewport.right - 8);
    assert(scoreBox.x + scoreBox.width < settingsBox.x);
    if (viewport.height > viewport.width) {
      const fan = await page.getByTestId('seat-north-cards').boundingBox();
      const north = await page.getByTestId('seat-north').boundingBox();
      assert(scoreBox.y + scoreBox.height <= fan.y, 'score must clear north fan');
      const overlaps = (a, b) =>
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      for (const seat of ['east', 'west']) {
        const side = await page.getByTestId(`seat-${seat}`).boundingBox();
        // Side columns may rise beside North's; they only must not touch it.
        assert(!overlaps(north, side), 'north and side plaques must not overlap');
        const stack = await page
          .getByTestId(`seat-${seat}-cards`)
          .locator(':scope > div')
          .first()
          .boundingBox();
        assert(
          side.y + side.height <= stack.y,
          `${seat} must sit above its card stack in ${viewport.name}: seat=${JSON.stringify(side)} stack=${JSON.stringify(stack)}`
        );
      }
    }
    await assertMinimumTouchTargets(page, 'table chrome', viewport);
    await page.screenshot({ path: `${shots}/${viewport.name}.png` });

    await score.click();
    await page.getByRole('button', { name: 'Close every hand' }).waitFor();
    assertInsideViewport(
      'history window',
      await page.getByTestId('table-utility-window').boundingBox(),
      viewport
    );
    // The ledger is already present on mount, not inferred from score changes.
    assert.match(await page.getByTestId('history-hand-9').innerText(), /12 ♥/);
    assert.match(await page.getByTestId('history-hand-9').innerText(), /48–29/);
    await page.screenshot({ path: `${shots}/${viewport.name}-history.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Close every hand' }).waitFor({ state: 'hidden' });

    await settings.click();
    const close = page.getByRole('button', { name: 'Close table settings' });
    await close.waitFor();
    assertInsideViewport(
      'settings window',
      await page.getByTestId('table-utility-window').boundingBox(),
      viewport
    );
    assert.equal(
      await page.getByRole('switch', { name: 'Sound' }).getAttribute('aria-disabled'),
      null
    );
    assert.equal(
      await page.getByRole('switch', { name: 'Haptics' }).getAttribute('aria-disabled'),
      null
    );
    await assertMinimumTouchTargets(page, 'table settings', viewport);
    await page.screenshot({ path: `${shots}/${viewport.name}-settings.png` });
    await page.getByRole('button', { name: 'Leave table', exact: true }).click();
    await page.getByRole('button', { name: 'Stay at table' }).waitFor();
    assertInsideViewport(
      'leave window',
      await page.getByTestId('table-utility-window').boundingBox(),
      viewport
    );
    await page.screenshot({ path: `${shots}/${viewport.name}-confirm.png` });
    await page.getByRole('button', { name: 'Stay at table' }).click();
    await settings.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Stay at table' }).count(), 0);
    // Outside dismissal closes the utility.
    await settings.click();
    await close.waitFor();
    await page.mouse.click(viewport.width - 2, viewport.height / 2);
    await close.waitFor({ state: 'hidden' });
    await settings.click();
    await page.getByRole('button', { name: 'Leave table', exact: true }).click();
    await page.getByRole('button', { name: 'Stay at table' }).waitFor();
    await page.getByRole('button', { name: 'Leave table', exact: true }).click();
    await page.getByTestId('table-utility-window').waitFor({ state: 'hidden' });
    await page.goto(`${base}/table-dev?phase=playing&safeArea=${viewport.safeArea}`);
    await page.getByRole('button', { name: 'US 36, THEM 29. Every hand.' }).click();
    await page.getByText('No completed hands yet', { exact: true }).waitFor();
    console.log(
      `PASS ${viewport.name}: safe areas, 44pt targets, history deltas/order, settings, cancel, Escape/outside dismissal`
    );
    await page.close();
  }
} finally {
  await browser.close();
}
