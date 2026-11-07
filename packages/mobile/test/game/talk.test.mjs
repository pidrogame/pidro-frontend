import { describe, expect, it } from 'bun:test';
import {
  land,
  landingMs,
  saidFrom,
  tailFit,
  talkTable,
  twoLines,
  typingFor,
  unreadBy,
} from '../../src/features/game/talk.ts';

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

  it('a seat a bot took closes talk, though the readiness list still says human', () => {
    const list = {
      north: { occupant_type: 'human' },
      east: { occupant_type: 'human' },
      south: { occupant_type: 'bot' },
      west: { occupant_type: 'bot' },
    };
    const live = (a, b) => ({
      north: { status: a },
      east: { status: b },
      south: { status: 'permanent_bot' },
      west: { status: 'permanent_bot' },
    });
    expect(talkTable(list, live('normal', 'bot_substitute'))).toBe(false);
    expect(talkTable(list, live('normal', 'reconnecting'))).toBe(true);
    expect(talkTable(list, live('normal', 'normal'))).toBe(true);
  });

  it('lets adults type, asks guests to make an account, and tells a teen nothing', () => {
    expect(typingFor(true, false)).toBe('type');
    expect(typingFor(false, true)).toBe('guest');
    // A 13 to 17 has an account and does not read typed talk.
    expect(typingFor(false, false)).toBeNull();
    // The server's word wins over what the client believes about guests.
    expect(typingFor(true, true)).toBe('type');
    expect(typingFor(undefined, false)).toBeNull();
  });

  it('names the people seated with you who will not see typing, never bots or you', () => {
    const seats = {
      north: { occupant_type: 'human', reads_typed: true },
      east: { occupant_type: 'human', reads_typed: false },
      south: { occupant_type: 'human', reads_typed: false },
      west: { occupant_type: 'bot' },
    };
    expect(unreadBy(seats, 'south')).toEqual(['east']);
    expect(unreadBy(seats, 'east')).toEqual(['south']);
    expect(unreadBy({ ...seats, east: { occupant_type: 'vacant' } }, 'south')).toEqual([]);
    expect(unreadBy(null, 'south')).toEqual([]);
  });

  // PID-396: an upright bubble's tail says the offered word in the largest size its room holds.
  it('fits the offered word to the tail: body, then small, then two lines, else the bubble alone', () => {
    const nice = { body: 99, small: 87, two: 56 };
    expect(tailFit(99, nice)).toBe('body');
    expect(tailFit(98.5, nice)).toBe('small');
    expect(tailFit(87, nice)).toBe('small');
    expect(tailFit(86.5, nice)).toBe('two');
    expect(tailFit(56, nice)).toBe('two');
    // Too wide in every size: Thanks! on a 360pt phone.
    expect(tailFit(70, { body: 83, small: 72, two: 72 })).toBeNull();
    // Under 56pt even a word that would fit is left out.
    expect(tailFit(55.5, { body: 40, small: 36, two: 36 })).toBeNull();
  });

  it('breaks a word in two at the space nearest its middle', () => {
    expect(twoLines('Nice trick!')).toBe('Nice\ntrick!');
    expect(twoLines('ab cd efghijk lm')).toBe('ab cd\nefghijk lm');
    expect(twoLines('Thanks!')).toBe('Thanks!');
  });
});
