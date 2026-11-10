// Browser coverage of the shared team list; native safe areas still need device coverage.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import {
  assertMinimumTouchTargets,
  assertTeamLayout,
  suppressDevOverlays,
  waitForImages,
} from './ui-test-utils.mjs';

const baseUrl = process.env.MOBILE_BASE_URL ?? 'http://localhost:8081';
const shots = process.env.UI_SHOT_DIR ?? '/tmp/pidro-waiting-seats';
const viewports = [
  { name: 'portrait', width: 390, height: 844 },
  { name: 'small-portrait', width: 375, height: 667 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
];
// PID-418: a seated player's rows say who is ready; the footer no longer counts them.
const readyRow = (page, position) =>
  page.getByTestId(`new-table-seat-${position}`).getByText('Ready', { exact: true });
const browser = await chromium.launch({ headless: true });
await mkdir(shots, { recursive: true });
let checks = 0;
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    for (const phase of ['waiting', 'waiting-host', 'ready', 'ready-host']) {
      await page.goto(`${baseUrl}/table-dev?phase=${phase}`);
      await page.getByTestId('waiting-table').waitFor();
      await suppressDevOverlays(page);
      await page.evaluate(() => document.fonts.ready);
      await waitForImages(page);
      await assertTeamLayout(page, viewport, `${viewport.name} ${phase}`);
      await page.getByTestId('waiting-rule-set').waitFor();
      await page.getByTestId('waiting-rules-menu').waitFor();
      assert.equal(
        await page
          .getByRole('button', { name: /^(Manage |Move to |Lock joins|Unlock joins|Table$)/ })
          .count(),
        0
      );
      await assertMinimumTouchTargets(page, phase, viewport);
      if (phase.startsWith('ready')) {
        const ready = page.getByRole('button', { name: "I'm ready", exact: true });
        await ready.click();
        const confirmed = page.getByRole('button', { name: "You're ready", exact: true });
        await confirmed.waitFor();
        assert.equal(await confirmed.isDisabled(), true);
        await readyRow(page, 'south').waitFor();
        assert.equal(await page.getByText(/of 4 ready/).count(), 0);
      }
      await page.screenshot({ path: `${shots}/${viewport.name}-${phase}.png` });
      checks++;
    }

    // Failure must leave the intent retryable, without inventing server confirmation.
    await page.goto(`${baseUrl}/table-dev?phase=ready-solo&readyResult=error`);
    await readyRow(page, 'north').waitFor();
    assert.equal(await readyRow(page, 'south').count(), 0);
    await page.getByRole('button', { name: "I'm ready", exact: true }).click();
    await page.getByText('Readiness was not confirmed.', { exact: false }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: "I'm ready", exact: true }).isEnabled(),
      true
    );
    await page.goto(`${baseUrl}/table-dev?phase=ready-solo&viewer=east`);
    await readyRow(page, 'north').waitFor();
    assert.equal(await readyRow(page, 'east').count(), 0);
    await page.getByRole('button', { name: "I'm ready", exact: true }).click();
    await readyRow(page, 'east').waitFor();

    // Occupied chairs go straight to removal confirmation, never a host settings panel.
    await page.goto(`${baseUrl}/table-dev?phase=ready-host`);
    await page.getByTestId('new-table-seat-east').click();
    const remove = page.getByRole('button', { name: 'Remove from table', exact: true });
    await remove.waitFor();
    assert.equal(await page.getByRole('button', { name: /^Move to / }).count(), 0);
    await remove.click();
    const vacant = page.getByTestId('new-table-seat-east');
    await vacant.getByText('Open seat', { exact: true }).waitFor();
    await vacant.click();
    const picker = page.getByTestId('seat-picker-container');
    await picker.waitFor();
    // After opening every choice is there, and the picker opens on the seat as it is.
    assert.equal(await picker.getByRole('radio').count(), 5);
    assert.equal(
      await picker.getByRole('radio', { name: /^Anyone, .+/ }).getAttribute('aria-checked'),
      'true'
    );
    await picker.getByRole('radio', { name: /^Bot, .+/ }).waitFor();
    if (viewport.width < viewport.height && viewport.width < 600)
      await picker.getByRole('button', { name: /^A friend, .+/ }).waitFor();
    else await picker.getByTestId('friend-picker').waitFor();

    await page.goto(`${baseUrl}/table-dev?phase=waiting-host&fixture=held`);
    const held = page.getByTestId('new-table-seat-east');
    await held.getByText('Invited · not online yet', { exact: true }).waitFor();
    await held.click();
    await page.getByTestId('seat-picker-container').waitFor();
    assert.equal(await picker.getByRole('radio').count(), 5);
    assert.equal(await picker.locator('[aria-checked="true"]').count(), 0);
    if (viewport.width < viewport.height && viewport.width < 600)
      assert.equal(await picker.getByRole('button', { name: /^A friend, Nora/ }).count(), 1);
    else await picker.getByTestId('friend-picker').waitFor();

    await page.goto(`${baseUrl}/table-dev?phase=ready-host&role=spectator`);
    await page.getByTestId('waiting-table').waitFor();
    await page.getByRole('button', { name: 'Back to lobby', exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole('button', {
          name: /I'm ready|Remove from table|^(Manage |Move to |Lock joins|Unlock joins)/,
        })
        .count(),
      0,
      'spectators have no player or host intents'
    );
    // Spectators keep the standing footer and say nothing.
    await page.getByTestId('waiting-rules-menu').waitFor();
    await page.getByText(/^\d of 4 ready$/).waitFor();
    assert.equal(await page.getByTestId('waiting-talk-field').count(), 0);
    await page.close();
  }
  console.log(
    `waiting-seats ok: ${checks} layouts; readiness, retry, viewer rotation, kick, vacant/held choices`
  );
} finally {
  await browser.close();
}
