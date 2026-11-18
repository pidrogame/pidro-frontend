import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.MOBILE_BASE_URL ?? 'http://localhost:8081';
const received = [
  'clubs_8',
  'spades_14',
  'hearts_3',
  'diamonds_11',
  'clubs_13',
  'hearts_10',
  'spades_2',
  'diamonds_6',
  'hearts_12',
];
// Classic's order: hearts, diamonds, spades, clubs (PID-461).
const sorted = [
  'hearts_12',
  'hearts_10',
  'hearts_3',
  'diamonds_11',
  'diamonds_6',
  'spades_14',
  'spades_2',
  'clubs_13',
  'clubs_8',
];
// Explicit expectations, independent of the production clockwise helper.
const orders = {
  north: ['east', 'south', 'west', 'north'],
  east: ['south', 'west', 'north', 'east'],
  south: ['west', 'north', 'east', 'south'],
  west: ['north', 'east', 'south', 'west'],
};
const browser = await chromium.launch({ headless: true });
try {
  for (const [dealer, order] of Object.entries(orders)) {
    const page = await browser.newPage({
      viewport: dealer === 'west' ? { width: 390, height: 844 } : { width: 1050, height: 780 },
      deviceScaleFactor: 2,
    });
    // Observe the actual production controller + renderer. This also catches
    // a one-frame bidding flash and updates which accidentally restart the deal.
    await page.addInitScript(() => {
      window.dealFrames = [];
      new MutationObserver(() => {
        const node = document.querySelector('[data-testid="deal-presentation"]');
        if (!node) return;
        const value = node.getAttribute('aria-label');
        const bidding = !!document.querySelector('[data-testid="bidding-window"]');
        const previous = window.dealFrames.at(-1);
        if (value !== previous?.value || bidding !== previous?.bidding) {
          window.dealFrames.push({ value, bidding, time: performance.now(), ...JSON.parse(value) });
        }
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-label'],
      });
    });
    await page.goto(`${base}/table-dev?phase=bidding&role=player&deal=true&dealer=${dealer}`);
    await page.getByTestId('bidding-window').waitFor({ timeout: 30000 });
    const frames = await page.evaluate(() => window.dealFrames);
    const packets = frames.filter(
      (frame, index) =>
        frame.stage === 'dealing' &&
        Object.values(frame.counts).reduce((a, b) => a + b, 0) > 0 &&
        JSON.stringify(frame.counts) !== JSON.stringify(frames[index - 1]?.counts)
    );
    assert.equal(packets.length, 12, `${dealer}: all twelve packets must render`);
    const counts = { north: 0, east: 0, south: 0, west: 0 };
    packets.forEach((frame, i) => {
      counts[order[i % 4]] += 3;
      assert.deepEqual(frame.counts, counts, `${dealer}: packet ${i + 1}`);
      assert.deepEqual(
        frame.hand,
        received.slice(0, counts.south),
        'Preserve unsorted receive order'
      );
    });
    const sorting = frames.find((frame) => frame.stage === 'sorting');
    assert.ok(sorting, 'Sort must be a separate visible stage');
    assert.deepEqual(sorting.hand, sorted);
    assert.ok(
      sorting.time - packets.at(-1).time >= 500,
      'Final packet must land and pause before sorting'
    );
    assert.ok(
      frames.filter((frame) => frame.stage !== 'ready').every((frame) => !frame.bidding),
      'No bidding during deal or sort'
    );
    const bidding = frames.find((frame) => frame.bidding);
    assert.ok(bidding.time - sorting.time >= 500, 'Wait for the sort to settle');
    assert.deepEqual(bidding.hand, sorted);
    console.log(
      `PASS dealer ${dealer}: clockwise 3×3, receive order, settle/read/sort, bidding gate`
    );
    if (dealer === 'north') {
      await page.evaluate(() => {
        window.sameDocument = true;
        const url = new URL(location.href);
        url.searchParams.set('dealer', 'east');
        history.pushState(null, '', url);
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await page.getByTestId('bidding-window').waitFor({ state: 'hidden', timeout: 5000 });
      await page.waitForFunction(
        () =>
          JSON.parse(
            document
              .querySelector('[data-testid="deal-presentation"]')
              ?.getAttribute('aria-label') ?? '{}'
          ).stage === 'dealing'
      );
      await page.getByTestId('bidding-window').waitFor({ timeout: 15000 });
      assert.equal(await page.evaluate(() => window.sameDocument), true);
      console.log('PASS same-document dealer change: deal restarts and reaches bidding');
    }
    await page.close();
  }

  for (const reduced of [false, true]) {
    const page = await browser.newPage({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.addInitScript(() => {
      window.dealStages = [];
      new MutationObserver(() => {
        const value = document
          .querySelector('[data-testid="deal-presentation"]')
          ?.getAttribute('aria-label');
        if (value) window.dealStages.push(JSON.parse(value).stage);
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-label'],
      });
    });
    await page.goto(
      `${base}/table-dev?phase=bidding&role=player&deal=${reduced ? 'true' : 'cold'}`
    );
    await page.getByTestId('bidding-window').waitFor();
    const state = JSON.parse(
      await page.getByTestId('deal-presentation').getAttribute('aria-label')
    );
    assert.equal(state.stage, 'ready');
    assert.deepEqual(state.hand, sorted);
    const stages = await page.evaluate(() => window.dealStages);
    assert.ok(
      stages.length > 0 && stages.every((stage) => stage === 'ready'),
      'Must skip the entire presentation, not just finish eventually'
    );
    console.log(`PASS ${reduced ? 'reduced motion' : 'cold reconnect'}: complete sorted hand`);
    await page.close();
  }
} finally {
  await browser.close();
}
