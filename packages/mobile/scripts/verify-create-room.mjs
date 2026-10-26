import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  assertInsideViewport,
  assertMinimumTouchTargets,
  assertTeamLayout,
  suppressDevOverlays,
  waitForScreenshotReady,
} from './ui-test-utils.mjs';

const baseUrl = process.env.MOBILE_BASE_URL ?? 'http://localhost:8081';
const output = process.env.UI_SHOT_DIR ?? '/tmp/pidro-create';
const fixtures = [
  'setup',
  'partner',
  'bots',
  'opened',
  'ready',
  'louisiana',
  'requirement',
  'password',
  'picker',
  'friends',
  'guest',
  'live-picker',
  'live-friends',
  'live-error',
];
const pickerFixtures = ['picker', 'friends', 'live-picker', 'live-friends', 'live-error'];
const browser = await chromium.launch({ headless: true });
await mkdir(output, { recursive: true });
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    for (const fixture of fixtures) {
      await page.goto(`${baseUrl}/ui-dev?state=new-table&fixture=${fixture}`);
      const live = ['opened', 'ready', 'guest'].includes(fixture) || fixture.startsWith('live-');
      const screen = page.getByTestId(live ? 'waiting-table' : 'new-table-screen');
      await screen.waitFor();
      await suppressDevOverlays(page);
      await page.evaluate(() => document.fonts.ready);
      await assertTeamLayout(page, viewport, `${fixture} ${viewport.width}x${viewport.height}`);
      if (!pickerFixtures.includes(fixture)) {
        await assertMinimumTouchTargets(page, `new-table-${fixture}`, viewport);
      }
      assert.equal(await page.getByTestId('create-room-window').count(), 0);
      assert.equal(
        await page
          .getByRole('button', { name: /^(Move to|Lock joins|Unlock joins|Manage )/ })
          .count(),
        0
      );
      if (fixture === 'setup') {
        for (const position of ['south', 'east', 'west'])
          assert.match(
            await page.getByTestId(`new-table-seat-${position}`).innerText(),
            /Anyone|Open/
          );
        const finnish = screen.getByRole('radio', { name: 'Ostrobothnian', exact: true });
        const louisiana = screen.getByRole('radio', { name: 'Louisiana', exact: true });
        assert.equal(await finnish.getAttribute('aria-checked'), 'true');
        await louisiana.click();
        assert.equal(await louisiana.getAttribute('aria-checked'), 'true');
        assert.equal(await finnish.getAttribute('aria-checked'), 'false');
      }
      const footer = {
        setup: 'Open the table',
        bots: 'Start the game',
        opened: 'Share the table link',
        ready: "I'm ready",
      }[fixture];
      if (footer) {
        const action = screen.getByRole('button', { name: footer, exact: true });
        assert.ok(await action.isVisible());
        const box = await action.boundingBox();
        assertInsideViewport('footer', box, viewport);
        assert.ok(box.width >= 44 && box.height >= 44, 'footer touch target');
      }
      if (live) await page.getByTestId('waiting-rule-set').waitFor();
      if (fixture === 'picker') {
        const picker = page.getByTestId('seat-picker-container');
        await picker.waitFor();
        assert.equal(await picker.getByRole('radio').count(), 5);
        for (const choice of [
          'Anyone',
          'Bot',
          '100+ games played',
          '1000+ games played',
          'With password',
        ])
          await picker
            .getByRole('radio', { name: new RegExp(`^${choice.replace(/[+]/g, '\\+')}, .+`) })
            .waitFor();
        if (viewport.width < viewport.height && viewport.width < 600)
          await picker.getByRole('button', { name: /^A friend, .+/ }).waitFor();
        else await picker.getByTestId('friend-picker').waitFor();
      }
      if (fixture === 'friends') await page.getByTestId('friend-picker').waitFor();
      if (fixture === 'guest') {
        await page.getByTestId('new-table-seat-east').click();
        assert.equal(
          await page.getByTestId('seat-picker-container').count(),
          0,
          'nonhost cannot edit seats'
        );
        assert.equal(
          await page.getByRole('button', { name: 'Remove from table', exact: true }).count(),
          0
        );
        // The room carries the host's password; only the host may read it.
        assert.doesNotMatch(
          await page.getByTestId('new-table-seat-west').innerText(),
          /4821/,
          'nonhost never sees the password'
        );
      }
      // The picker fades in; capture it settled so the baseline is the same every run.
      await waitForScreenshotReady(page);
      await page.screenshot({
        path: resolve(output, `new-table-${fixture}-${viewport.width}x${viewport.height}.png`),
      });
      console.log(`new-table-${fixture}: ${viewport.width}x${viewport.height}`);
      if (fixture.startsWith('live-')) await assertLivePicker(page, fixture, viewport);
    }

    // Keep real creation payload/error recovery coverage, independent of fixture callbacks.
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
            accessToken: 'creation-test',
            refreshToken: null,
            user: { id: 'viewer', username: 'Viewer', age_band: '18_plus' },
          },
          version: 0,
        })
      );
      localStorage.setItem(
        'settings-storage',
        JSON.stringify({ state: { preferredRuleSet: 'finnish' }, version: 0 })
      );
    });
    const requests = [];
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/lobby'))
        await route.fulfill({
          json: {
            data: { open_tables: [], my_rejoinable: [], substitute_needed: [], spectatable: [] },
          },
        });
      else if (path.endsWith('/rooms') && request.method() === 'POST') {
        requests.push(request.postDataJSON());
        await route.fulfill({ status: 503, json: { errors: [{ detail: 'Try again fixture' }] } });
      } else await route.fulfill({ status: 503, json: {} });
    });
    await page.goto(`${baseUrl}/lobby`);
    await page.getByRole('button', { name: 'Start a table', exact: true }).first().click();
    const form = page.getByTestId('new-table-screen');
    await form.waitFor();
    assert.equal(await form.getByRole('textbox').count(), 0, 'no table name');
    const submit = async () => {
      const response = page.waitForResponse(
        (res) => new URL(res.url()).pathname.endsWith('/rooms') && res.request().method() === 'POST'
      );
      await form.getByRole('button', { name: 'Open the table', exact: true }).click();
      await response;
      await form.getByRole('alert').waitFor();
    };
    await submit();
    assert.deepEqual(requests[0], {
      rule_set: 'finnish',
      seats: { seat_2: 'open', seat_3: 'open', seat_4: 'open' },
    });
    await page.getByTestId('new-table-seat-south').click();
    await page
      .getByTestId('seat-picker-container')
      .getByRole('radio', { name: /^100\+ games played, .+/ })
      .click();
    await page.getByTestId('seat-picker-container').waitFor({ state: 'detached' });
    await form.getByRole('radio', { name: 'Louisiana', exact: true }).click();
    await submit();
    assert.deepEqual(
      requests[1],
      {
        rule_set: 'louisiana',
        seats: { seat_2: 'open', seat_3: { type: 'open', min_games: 100 }, seat_4: 'open' },
      },
      'Partner maps to seat_3 and requirement survives retry'
    );
    await page.close();
  }
} finally {
  await browser.close();
}

/** After opening, each choice is one call; the fixture server answers and the rows show it. */
async function assertLivePicker(page, fixture, viewport) {
  const picker = page.getByTestId('seat-picker-container');
  const radio = (name) =>
    picker.getByRole('radio', { name: new RegExp(`^${name.replace(/[+]/g, '\\+')}, .+`) });
  const checked = async (name) =>
    assert.equal(await radio(name).getAttribute('aria-checked'), 'true', `${name} is the choice`);
  const row = (position) => page.getByTestId(`new-table-seat-${position}`);
  const choose = async (position, name, expected) => {
    await radio(name).click();
    await picker.waitFor({ state: 'detached' });
    for (let tries = 0; !expected.test(await row(position).innerText()); tries++) {
      assert.ok(tries < 50, `${position} reads ${expected} after ${name}`);
      await page.waitForTimeout(100);
    }
    await row(position).click();
    await checked(name);
  };
  const split = viewport.width > viewport.height || viewport.width >= 600;
  if (fixture === 'live-picker') {
    await checked('With password 4821');
    await choose('west', 'Bot', /^Antti\n/);
    await choose('west', '1000+ games played', /Waiting…$/);
    await choose('west', 'With password 4821', /password 4821$/);
    await choose('west', 'Anyone', /Waiting…$/);
    await picker.getByRole('button', { name: 'Cancel', exact: true }).first().click();
    await picker.waitFor({ state: 'detached' });
    await row('south').click();
    if (!split) await picker.getByRole('button', { name: /^A friend, Maija/ }).waitFor();
    else await picker.getByLabel('Maija', { exact: true }).waitFor();
    await choose('south', 'Bot', /^Antti\n/);
  }
  if (fixture === 'live-friends') {
    const friends = page.getByTestId('friend-picker');
    await friends.getByLabel('Maija', { exact: true }).waitFor();
    for (const label of ['Nora, In a game with others']) {
      const greyed = friends.getByLabel(label, { exact: true });
      assert.equal(await greyed.getAttribute('aria-disabled'), 'true', `${label} is not tappable`);
    }
    await friends.getByRole('button', { name: 'Invite Pekka', exact: true }).click();
    await picker.waitFor({ state: 'detached' });
    for (
      let tries = 0;
      !/Pekka\nInvited · waiting for an answer/.test(await row('south').innerText());
      tries++
    ) {
      assert.ok(tries < 50, 'south reads Pekka, invited');
      await page.waitForTimeout(100);
    }
  }
  if (fixture === 'live-error') {
    await radio('Bot').click();
    await picker
      .getByRole('alert')
      .getByText('This seat could not be changed. Please try again.')
      .waitFor();
    await checked('With password 4821');
    assert.match(await row('west').innerText(), /password 4821/);
    // A person took the seat meanwhile: the picker closes and the reason stays on the screen.
    await radio('Anyone').click();
    await page
      .getByTestId('waiting-table')
      .getByRole('alert')
      .getByText('Someone sat down in this seat.')
      .waitFor();
    await picker.waitFor({ state: 'detached' });
    assert.match(await row('west').innerText(), /^Eli/);
  }
}
