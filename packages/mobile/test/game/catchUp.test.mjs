import { expect, test } from 'bun:test';
import { catchUpPace } from '../../src/features/game/catchUp.ts';

// The dealer cut as it is designed: four cuts reach the winner after 3280 ms,
// and the winner should stay up 700 ms; the server moves on after 3000 ms.
const cut = { motionMs: 3280, holdMs: 700, windowMs: 3000 };

test('a moment that fits its window plays as designed', () => {
  expect(catchUpPace({ motionMs: 3000, holdMs: 700, windowMs: 5000, lateMs: 0 })).toBe(1);
  expect(catchUpPace({ motionMs: 3000, holdMs: 700, windowMs: 5000, lateMs: 1300 })).toBe(1);
});

test('a moment longer than its window plays faster, so its result is up before the server moves on', () => {
  expect(catchUpPace({ ...cut, lateMs: 0 })).toBeCloseTo(2300 / 3280, 6);
  // A phone a second behind has 1300 ms for the cuts.
  expect(catchUpPace({ ...cut, lateMs: 1000 })).toBeCloseTo(1300 / 3280, 6);
});

test('a phone too far behind skips to where the moment ends', () => {
  // 1100 ms for 3280 ms of motion is three times too fast to read.
  expect(catchUpPace({ ...cut, lateMs: 1200 })).toBe(0);
  expect(catchUpPace({ ...cut, lateMs: 4000 })).toBe(0);
});

test('without a window the client cannot know it is behind and plays as designed', () => {
  expect(catchUpPace({ ...cut, windowMs: undefined, lateMs: 5000 })).toBe(1);
  expect(catchUpPace({ ...cut, windowMs: 0, lateMs: 0 })).toBe(1);
  // A clock that says it arrived in the future is not early.
  expect(catchUpPace({ ...cut, lateMs: -500 })).toBeCloseTo(2300 / 3280, 6);
});
