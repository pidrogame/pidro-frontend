import { describe, expect, it } from 'bun:test';
import { land, landingMs, saidFrom, talkTable } from '../../src/features/game/talk.ts';

describe('table talk', () => {
  it('reads a word or a typed line, and drops what it cannot show', () => {
    expect(saidFrom({ seat: 'north', user_id: 'u1', item: 'word_nice' })).toEqual({
      seat: 'north',
      userId: 'u1',
      item: 'word_nice',
    });
    expect(saidFrom({ seat: 'east', user_id: 'u2', text: '  Bra spelat  ' })).toEqual({
      seat: 'east',
      userId: 'u2',
      text: 'Bra spelat',
    });
    // An item a newer server added is not shown as text.
    expect(saidFrom({ seat: 'east', user_id: 'u2', item: 'word_taunt' })).toBeNull();
    expect(saidFrom({ seat: 'middle', user_id: 'u2', item: 'word_nice' })).toBeNull();
    expect(saidFrom({ seat: 'east', item: 'word_nice' })).toBeNull();
    expect(saidFrom({ seat: 'east', user_id: 'u2', text: '   ' })).toBeNull();
  });

  it('counts the same coin again, and starts over for anything else', () => {
    const heart = { seat: 'south', userId: 'u', item: 'coin_heart' };
    const twice = land(land(undefined, heart, 1), heart, 2);
    expect(twice.count).toBe(2);
    expect(land(twice, heart, 3).count).toBe(3);
    expect(land(twice, { ...heart, item: 'coin_thumb' }, 3).count).toBe(1);
    // The same word twice is a word, not ×2.
    const nice = { ...heart, item: 'word_nice' };
    expect(land(land(undefined, nice, 1), nice, 2).count).toBe(1);
  });

  it('holds a word three seconds and a typed line longer, by length', () => {
    expect(landingMs({})).toBe(3_000);
    expect(landingMs({ text: 'x'.repeat(40) })).toBeGreaterThan(3_000);
    expect(landingMs({ text: 'x'.repeat(80) })).toBeGreaterThan(
      landingMs({ text: 'x'.repeat(40) })
    );
  });

  it('talks only where two or more people sit, as the server counts them', () => {
    const seats = (...types) =>
      Object.fromEntries(
        ['north', 'east', 'south', 'west'].map((p, i) => [p, { occupant_type: types[i] }])
      );
    expect(talkTable(seats('human', 'bot', 'bot', 'bot'))).toBe(false);
    expect(talkTable(seats('human', 'vacant', 'human', 'bot'))).toBe(true);
    expect(talkTable(seats('bot', 'bot', 'bot', 'bot'))).toBe(false);
    // Before the first readiness snapshot nothing talks.
    expect(talkTable(null)).toBe(false);
  });
});
