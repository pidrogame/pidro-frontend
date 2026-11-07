import { describe, expect, test } from 'bun:test';
import { adGate, adOutcome } from '../../src/features/ads/adGate.ts';

const due = { eligible: true, next_game_needs_ad: true, games_until_ad: 0, free_games_left: 0 };
const offer = { ads: due, premium: false, adsAvailable: true, context: 'solo' };

describe('adGate', () => {
  test('offers only when the server says this eligible player needs an ad before this solo game', () => {
    expect(adGate(offer)).toBe('offer');
  });

  test.each([
    ['Premium', { premium: true }],
    ['not eligible', { ads: { ...due, eligible: false } }],
    ['no ad due yet', { ads: { ...due, next_game_needs_ad: false, games_until_ad: 2 } }],
    ['an older server without ads', { ads: undefined }],
    ['no ads in this build', { adsAvailable: false }],
    ['an online table', { context: 'online' }],
    ['mid-game', { context: 'mid-game' }],
  ])('deals for %s', (_, change) => {
    expect(adGate({ ...offer, ...change })).toBe('deal');
  });

  // The server never asks a non-eligible player, but the client never offers on its own say-so.
  test('deals when not eligible even if an ad is marked due', () => {
    expect(adGate({ ...offer, ads: { ...due, eligible: false, next_game_needs_ad: true } })).toBe(
      'deal'
    );
  });
});

describe('adOutcome', () => {
  test('an ad watched to the end is reported and deals', () => {
    expect(adOutcome('earned')).toEqual({ report: 'watched', deal: true });
  });

  test('an ad that cannot play is reported and deals anyway', () => {
    expect(adOutcome('unavailable')).toEqual({ report: 'unavailable', deal: true });
  });

  test('an ad closed early reports nothing and keeps the sheet', () => {
    expect(adOutcome('dismissed')).toEqual({ report: null, deal: false });
  });

  test('closing the sheet is reported as dismissed and does not deal', () => {
    expect(adOutcome('closed')).toEqual({ report: 'dismissed', deal: false });
  });
});
