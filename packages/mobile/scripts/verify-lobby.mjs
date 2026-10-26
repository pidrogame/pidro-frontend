import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { assertMinimumTouchTargets, suppressDevOverlays } from './ui-test-utils.mjs';

const baseUrl = process.env.MOBILE_BASE_URL ?? 'http://localhost:8081';
const output = process.env.UI_SHOT_DIR ?? '/tmp/pidro-lobby';
const player = (id, username, seat_index) => ({
  seat_index,
  status: 'occupied',
  player: { id, username },
});
const rooms = [
  {
    code: 'MEK',
    name: 'Mek’s table',
    status: 'waiting',
    available_positions: ['east', 'west'],
    seats: [player('mek', 'Mek', 0), player('mag', 'Magnolia', 2)],
  },
  {
    code: 'SUES',
    name: 'Sues’ table',
    status: 'waiting',
    available_positions: ['south', 'west'],
    seats: [player('sues', 'Sues', 0), player('izzy', 'Izzy', 1)],
  },
  {
    code: 'HIDDEN42',
    name: 'A long table name that must never wrap',
    status: 'waiting',
    available_positions: ['south', 'east', 'west'],
    seats: [player('herr', 'HerrmannLongName', 0)],
  },
];
const viewports = [
  { name: 'portrait', width: 390, height: 844 },
  { name: 'small-phone', width: 320, height: 568 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'compact-landscape', width: 667, height: 375 },
  { name: 'tablet-portrait', width: 820, height: 1180 },
  { name: 'tablet-landscape', width: 1180, height: 820 },
];

async function compactEmptyState(page) {
  const panel = page.getByTestId('lobby-empty-state');
  const box = await panel.boundingBox();
  const button = await panel.getByRole('button').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(button.height >= 44 && button.height <= 60, 'empty action must stay content-height');
  assert.ok(box.height <= 230, 'empty notice must not fill the screen');
  assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, 'notice exceeds viewport');
  for (const child of await panel.locator('*').all()) {
    const rect = await child.boundingBox();
    assert.ok(
      rect &&
        rect.x >= box.x - 1 &&
        rect.y >= box.y - 1 &&
        rect.x + rect.width <= box.x + box.width + 1 &&
        rect.y + rect.height <= box.y + box.height + 1,
      'empty-state descendant is clipped'
    );
  }
}

async function equalRows(page, selector, checkGrid = false) {
  const rows = await page.locator(selector).all();
  assert.equal(rows.length, 3);
  const boxes = await Promise.all(rows.map((row) => row.boundingBox()));
  assert.ok(
    boxes.every((box) => box && Math.abs(box.height - boxes[0].height) < 1),
    'row heights differ'
  );
  assert.ok(
    boxes.every((box) => box.x >= 0 && box.x + box.width <= page.viewportSize().width),
    'row exceeds viewport'
  );
  if (checkGrid) {
    const { width, height } = page.viewportSize();
    const columns = width < height && width < 600 ? 1 : width > height && height >= 600 ? 3 : 2;
    assert.equal(new Set(boxes.map((box) => Math.round(box.x))).size, columns, 'grid column count');
  }
  assert.ok(
    boxes.every((box) => Math.abs(box.width - boxes[0].width) < 1),
    'grid row widths differ'
  );
  for (const [index, row] of rows.entries()) {
    const box = boxes[index];
    for (const button of await row.getByRole('button').all()) {
      const control = await button.boundingBox();
      assert.ok(
        control.x >= box.x &&
          control.x + control.width <= box.x + box.width &&
          control.y >= box.y &&
          control.y + control.height <= box.y + box.height,
        'seat control exceeds its row'
      );
    }
  }
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    let state = 'populated';
    let refuseJoin = false;
    let lobbyLoads = 0;
    const dialogs = [];
    const joins = [];
    const creates = [];
    await page.addInitScript(() => {
      localStorage.setItem(
        'age-gate-storage',
        JSON.stringify({ state: { ageBand: '18_plus', termsVersion: '1' }, version: 0 })
      );
      localStorage.setItem('news-seen:welcome', '1');
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: {
            accessToken: 'lobby-test-token',
            refreshToken: null,
            user: { id: 'viewer', username: 'Viewer', age_band: '18_plus' },
          },
          version: 0,
        })
      );
    });
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/rooms') && route.request().method() === 'POST') {
        creates.push(route.request().postDataJSON());
        await route.fulfill({ status: 503, json: { errors: [{ detail: 'Try again fixture' }] } });
      } else if (path.endsWith('/join')) {
        joins.push({ path, body: route.request().postDataJSON() });
        if (refuseJoin) {
          await route.fulfill({
            status: 422,
            json: { errors: [{ code: 'SEAT_TAKEN', detail: 'That chair was just taken.' }] },
          });
          return;
        }
        await route.fulfill({
          json: { data: { room: rooms[0], assigned_position: 'west' } },
        });
      } else if (path.endsWith('/lobby')) {
        lobbyLoads += 1;
        await route.fulfill(
          state === 'error'
            ? { status: 503, json: {} }
            : {
                json: {
                  data: {
                    open_tables: ['empty', 'busy', 'substitute'].includes(state) ? [] : rooms,
                    my_rejoinable: [],
                    substitute_needed:
                      state === 'substitute' ? [{ ...rooms[0], status: 'playing' }] : [],
                    spectatable: state === 'busy' ? [{ ...rooms[0], status: 'playing' }] : [],
                  },
                },
              }
        );
      } else {
        await route.fulfill({ status: 503, json: {} });
      }
    });
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto(`${baseUrl}/lobby`);
    await page.getByTestId('lobby-table-MEK').waitFor();
    assert.equal(await page.getByTestId('lobby-rule-filter').count(), 0);
    await page.evaluate(() => document.fonts.ready);
    await suppressDevOverlays(page);
    await equalRows(page, '[data-testid^="lobby-table-"]', true);
    await assertMinimumTouchTargets(page, 'lobby', viewport, { checkInputs: true });
    const first = page.getByTestId('lobby-table-MEK');
    assert.equal(await first.getByRole('button', { name: /^Join/ }).count(), 2);
    const mek = await first.getByText('Mek', { exact: true }).boundingBox();
    const magnolia = await first.getByText('Magnolia', { exact: true }).boundingBox();
    assert.equal(await first.getByRole('button', { name: /profile/ }).count(), 0);
    const east = await first.getByRole('button', { name: /^Join east/ }).boundingBox();
    const west = await first.getByRole('button', { name: /^Join west/ }).boundingBox();
    assert.ok(
      mek.x < magnolia.x && magnolia.x < east.x && east.x < west.x,
      'teams must be N/S versus E/W'
    );
    assert.ok(
      Math.abs(magnolia.y - mek.y) < 1 && Math.abs(east.y - west.y) < 1,
      'seats must share one row'
    );
    await page.screenshot({ path: resolve(output, `${viewport.name}.png`) });
    // A refusal stays on this row, refreshes the lobby, and leaves another chair usable.
    refuseJoin = true;
    const loadsBeforeRefusal = lobbyLoads;
    const refreshed = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/lobby')
    );
    await first.getByRole('button', { name: 'Join east seat', exact: true }).click();
    await first.getByText('This seat is occupied.', { exact: true }).waitFor();
    assert.equal(await first.getByText('That chair was just taken.', { exact: true }).count(), 0);
    await refreshed;
    assert.ok(lobbyLoads > loadsBeforeRefusal, 'refused seat join must refresh lobby');
    assert.equal(new URL(page.url()).pathname, '/lobby');
    assert.deepEqual(dialogs, [], 'seat refusal must not open an alert');
    assert.deepEqual(joins, [{ path: '/api/v1/rooms/MEK/join', body: { position: 'east' } }]);
    refuseJoin = false;
    joins.length = 0;
    await first.getByRole('button', { name: /^Join west/ }).click();
    await page.waitForURL((url) => url.pathname === '/game/MEK');
    assert.deepEqual(joins, [{ path: '/api/v1/rooms/MEK/join', body: { position: 'west' } }]);
    // Fresh lobby state after proving the join response was processed and routed.
    await page.goto(`${baseUrl}/lobby`);
    await page.getByTestId('lobby-table-MEK').waitFor();
    await suppressDevOverlays(page);
    await page.getByRole('textbox', { name: 'Find a player' }).fill('iZzY');
    assert.equal(await page.locator('[data-testid^="lobby-table-"]').count(), 1);
    await page.getByTestId('lobby-table-SUES').waitFor();
    for (const query of [
      'HIDDEN42',
      'A long table name that must never wrap',
      'no matching player',
    ]) {
      await page.getByRole('textbox', { name: 'Find a player' }).fill(query);
      await page.getByText('No matching tables', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-testid^="lobby-table-"]').count(), 0);
    }
    await page.getByText('No matching tables', { exact: true }).waitFor();
    await compactEmptyState(page);
    await page.screenshot({ path: resolve(output, `${viewport.name}-no-results.png`) });
    await page.getByRole('button', { name: 'Clear search' }).click();
    await page.getByTestId('lobby-table-MEK').waitFor();
    await page.getByRole('button', { name: 'Start a table', exact: true }).first().click();
    await page.getByTestId('new-table-screen').waitFor();
    for (const next of ['empty', 'error']) {
      state = next;
      await page.goto(`${baseUrl}/lobby`);
      await page
        .getByText(next === 'empty' ? 'No one is at a table yet' : 'Couldn’t load tables', {
          exact: true,
        })
        .waitFor();
      await suppressDevOverlays(page);
      await assertMinimumTouchTargets(page, `lobby-${next}`, viewport);
      if (next === 'error') await compactEmptyState(page);
      await page.screenshot({ path: resolve(output, `${viewport.name}-${next}.png`) });
      if (next === 'empty') {
        assert.equal(await page.getByText(/ online$/).count(), 0, 'no one else is online');
        assert.equal(await page.getByRole('textbox', { name: 'Find a player' }).count(), 0);
        // The quick-game link starts the same solo table as Home's tile.
        await page.getByRole('link', { name: 'Or play a quick game with bots' }).click();
        await page.getByText(/We could not start a solo game/).waitFor();
        assert.deepEqual(creates.at(-1).seats, { seat_2: 'ai', seat_3: 'ai', seat_4: 'ai' });
        await page.getByRole('button', { name: 'Join with a table code', exact: true }).click();
        await page.waitForURL((url) => url.pathname === '/join-code');
        await page.goBack();
        await page.getByRole('button', { name: 'Start a table', exact: true }).first().click();
        await page.getByTestId('new-table-screen').waitFor();
      } else {
        state = 'populated';
        await page.getByRole('button', { name: 'Try again' }).click();
        await page.getByTestId('lobby-table-MEK').waitFor();
      }
    }
    state = 'busy';
    await page.reload();
    await page.getByRole('button', { name: 'Watch', exact: true }).waitFor();
    assert.equal(
      await page.getByTestId('lobby-empty-state').count(),
      0,
      'watchable games must not be described as an empty lobby'
    );
    assert.equal(await page.getByTestId('lobby-empty').count(), 0);
    state = 'substitute';
    await page.reload();
    const substitute = page.getByTestId('lobby-table-MEK');
    await substitute.getByRole('button', { name: 'Sit in west seat', exact: true }).waitFor();
    assert.equal(await substitute.getByRole('button', { name: /^Join / }).count(), 0);
    joins.length = 0;
    await substitute.getByRole('button', { name: 'Sit in west seat', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/game/MEK');
    assert.deepEqual(joins, [{ path: '/api/v1/rooms/MEK/join', body: { position: 'west' } }]);
    await page.goto(`${baseUrl}/ui-dev?state=lobby-seats`);
    await page.getByTestId('lobby-table-SAMPLE0').waitFor();
    await equalRows(page, '[data-testid^="lobby-table-"]');
    await assertMinimumTouchTargets(page, 'lobby-badges', viewport);
    for (const value of ['100', '1,000']) {
      const badge = page.getByTestId('seat-requirement').filter({ hasText: `${value}+` });
      assert.equal(await badge.textContent(), `${value}+`);
      assert.ok(
        await badge.evaluate((el) => el.scrollWidth <= el.clientWidth),
        `${value} is clipped`
      );
    }
    await page.screenshot({ path: resolve(output, `${viewport.name}-badges.png`) });
    await page
      .getByTestId('lobby-table-SAMPLE2')
      .getByRole('button', { name: /^Join west/ })
      .click();
    assert.equal(await page.getByTestId('lobby-gallery-joined').textContent(), 'SAMPLE2: west');
    console.log(
      `lobby ok: ${viewport.name} — equal rows, team order, touch targets, refused join refresh, join payload, player-only search, create, empty (quick game, join code, start)/error, 100/1000 badges`
    );
    await context.close();
  }
} finally {
  await browser.close();
}
