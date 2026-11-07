import { expect, test } from 'bun:test';
import { startupUpdateDecision } from '../../src/features/appUpdate.ts';

const start = { enabled: true, inGame: false, finished: false, pending: false, elapsedMs: 0 };

test('cold start waits, but checking and fetching share a five-second deadline', () => {
  expect(startupUpdateDecision(start)).toBe('wait');
  expect(startupUpdateDecision({ ...start, elapsedMs: 4999 })).toBe('wait');
  expect(startupUpdateDecision({ ...start, elapsedMs: 5000 })).toBe('continue');
  expect(startupUpdateDecision({ ...start, pending: true, elapsedMs: 4999 })).toBe('reload');
  expect(startupUpdateDecision({ ...start, pending: true, elapsedMs: 5000 })).toBe('continue');
});

test('a downloaded update applies immediately, but never after entering the app or a game', () => {
  expect(startupUpdateDecision({ ...start, pending: true })).toBe('reload');
  for (const pending of [false, true]) {
    expect(startupUpdateDecision({ ...start, pending, inGame: true })).toBe('continue');
    expect(startupUpdateDecision({ ...start, pending, finished: true })).toBe('continue');
    expect(startupUpdateDecision({ ...start, pending, enabled: false })).toBe('continue');
  }
});
