import { test as base, expect } from '@playwright/test';
import { API } from './support/api';
import { AGE_ANSWERED, newPlayer, type Player } from './support/player';

type Options = { ageAnswered: boolean; welcomeSeen: boolean; unavailableExpected: boolean };

/**
 * `player` is this test's own identity. `page` has the age gate answered
 * (unless a test says `ageAnswered: false`) and Marcel's welcome already seen
 * (unless `welcomeSeen: false`), and fails the test on an uncaught
 * page error or an unexpected 5xx from the API, even when the screen looks right.
 * A test about an outage says `unavailableExpected: true`, which allows 503.
 */
export const test = base.extend<{ player: Player } & Options>({
  ageAnswered: [true, { option: true }],
  welcomeSeen: [true, { option: true }],
  unavailableExpected: [false, { option: true }],
  player: async ({}, use) => use(newPlayer()),
  page: async ({ page, player, ageAnswered, welcomeSeen, unavailableExpected }, use) => {
    await page.addInitScript(
      ({ age, installId, welcome }) => {
        if (age && !localStorage.getItem('age-gate-storage'))
          localStorage.setItem('age-gate-storage', age);
        if (welcome) localStorage.setItem('news-seen:welcome', '1');
        if (!localStorage.getItem('install-id:v1'))
          localStorage.setItem('install-id:v1', installId);
      },
      { age: ageAnswered ? AGE_ANSWERED : null, installId: player.installId, welcome: welcomeSeen }
    );
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
    page.on('response', (response) => {
      const status = response.status();
      if (
        response.url().startsWith(API) &&
        status >= 500 &&
        !(unavailableExpected && status === 503)
      ) {
        problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });
    await use(page);
    expect(problems).toEqual([]);
  },
});

export { expect };
