import { describe, expect, it } from 'bun:test';
import {
  dealerThrow,
  drewAt,
  drewCounts,
  makePlan,
  showAt,
} from '../../src/game/canvas/secondDealPlan.ts';
import { secondDealDurationMs, secondDealTiming } from '../../src/game/canvas/animationTiming.ts';

const seat = (kept, drawn, cardCount, discarded) => ({
  secondDeal: kept == null ? null : { kept, drawn },
  cardCount,
  discarded,
});
const card = (rank, suit) => ({
  key: `${suit}_${rank}`,
  textureKey: `${suit}_${rank}`,
  card: { rank, suit },
});

const held = [
  card(14, 'spades'),
  card(11, 'spades'),
  card(13, 'hearts'),
  card(8, 'diamonds'),
  card(4, 'clubs'),
  card(12, 'hearts'),
  card(7, 'clubs'),
  card(3, 'diamonds'),
  card(9, 'hearts'),
];

describe('the second deal at Classic’s pace', () => {
  // West deals. Nora (north) kept 1, Eli (east) 3, you 2. The server never
  // counts the dealer's.
  const yourHand = [
    card(14, 'spades'),
    card(11, 'spades'),
    card(10, 'spades'),
    card(6, 'hearts'),
    card(12, 'clubs'),
    card(7, 'diamonds'),
  ];
  const model = {
    phase: 'playing',
    dealerRelative: 'west',
    yourHand,
    seats: {
      north: seat(1, 5, 6),
      east: seat(3, 3, 6),
      south: seat(2, 4, 6),
      west: seat(null, null, 6),
    },
  };
  const plan = makePlan(model, held);
  const beats = plan.frames;

  it('has each player throw in turn from the dealer’s left, and never the dealer', () => {
    // Nine each, then north, east, you, in that order.
    expect(beats.slice(0, 4).map((frame) => frame.thrown)).toEqual([
      { north: 0, east: 0, south: 0, west: 0 },
      { north: 8, east: 0, south: 0, west: 0 },
      { north: 8, east: 6, south: 0, west: 0 },
      { north: 8, east: 6, south: 7, west: 0 },
    ]);
    expect(beats.every((frame) => frame.thrown.west === 0)).toBe(true);
    expect(beats.every((frame) => frame.hand.west === 9)).toBe(true);
  });

  // With count help the table says what each drew, from their refill on.
  it('counts what each player drew from their first card, and never the dealer’s here', () => {
    const first = (rel) => beats.findIndex((frame) => frame.drawn[rel] > 0);
    expect(beats[first('north') - 1].drew).toEqual({});
    expect(beats[first('north')].drew).toEqual({ north: 5 });
    expect(beats[first('east')].drew).toEqual({ north: 5, east: 3 });
    expect(beats.at(-1).drew).toEqual({ north: 5, east: 3, south: 4 });
    expect(drewCounts(model)).toEqual({ north: 5, east: 3, south: 4, west: 4 });
  });

  // PID-394: the pack lies beside the dealer from the first throw; the dealer
  // takes the four left after the twelve dealt, which slide to them.
  it('keeps the pack beside the dealer through the throws, counts it down, and has the dealer take the rest', () => {
    expect(beats.slice(0, 4).map((frame) => frame.pack)).toEqual([16, 16, 16, 16]);
    expect(beats.slice(4, -1).map((frame) => frame.pack)).toEqual([
      15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4,
    ]);
    expect(beats.slice(0, -1).every((frame) => !frame.taken)).toBe(true);
    expect(beats.at(-1)).toMatchObject({ pack: 0, taken: 4, ms: secondDealTiming.robMs });
  });

  it('deals one card at a time, player by player, and the dealer takes the rest', () => {
    const order = beats.slice(4, -1).map((frame, i, all) => {
      const before = i === 0 ? {} : all[i - 1].drawn;
      return Object.keys(frame.drawn).find((rel) => frame.drawn[rel] !== (before[rel] ?? 0));
    });
    expect(order).toEqual([
      ...Array(5).fill('north'),
      ...Array(3).fill('east'),
      ...Array(4).fill('south'),
    ]);
    const last = beats.at(-1);
    expect(last.hand).toEqual({ north: 6, east: 6, south: 6, west: 9 });
    expect(last.pack).toBe(0);
    expect(plan.yourThrown).toHaveLength(7);
    expect(plan.yourDrawn.map((c) => c.key)).toEqual([
      'spades_10',
      'hearts_6',
      'clubs_12',
      'diamonds_7',
    ]);
  });

  it('plays nothing out without every player’s counts', () => {
    expect(
      makePlan({ ...model, seats: { ...model.seats, east: { secondDeal: null } } }, held)
    ).toBeNull();
  });
});

describe('the second deal from a server that counts every throw (PID-306)', () => {
  // West deals and took up 12 (9 + the 3 left in the pack): threw 6.
  const yourHand = [
    card(14, 'spades'),
    card(11, 'spades'),
    card(10, 'spades'),
    card(6, 'hearts'),
    card(12, 'clubs'),
    card(7, 'diamonds'),
  ];
  const model = {
    phase: 'playing',
    dealerRelative: 'west',
    yourHand,
    seats: {
      north: seat(1, 5, 6, 8),
      east: seat(3, 3, 6, 6),
      south: seat(2, 4, 6, 7),
      west: seat(null, null, 6, 6),
    },
  };
  const plan = makePlan(model, held);

  it('ends on the dealer’s throw, after everyone else’s, and takes as long as counted', () => {
    const total = plan.frames.reduce((sum, frame) => sum + frame.ms, 0);
    expect(total).toBe(secondDealDurationMs(12));
    // The rest of the pack has reached the dealer by then.
    expect(showAt(plan.frames.at(-2), model, null)).toMatchObject({ pack: 0, taken: 4 });
    expect(showAt(plan.frames.at(-1), model, null)).toMatchObject({ pack: 0, taken: 0 });
    expect(plan.frames.map((frame) => !!frame.dealerThrew)).toEqual([
      ...Array(plan.frames.length - 1).fill(false),
      true,
    ]);
  });

  // PID-307: a throw is counted, not read; Classic shows the thrower backs too.
  it('shows your own throw as backs, like everyone’s, and the dealer’s as backs to count', () => {
    const yourThrow = showAt(plan.frames[3], model, null);
    expect(yourThrow.thrown.south).toBe(7);
    expect(yourThrow.faces).toEqual({});
    expect(yourThrow.thrown.west).toBe(0);

    const dealers = showAt(plan.frames.at(-1), model, null);
    expect(dealers.thrown).toEqual({ north: 0, east: 0, south: 0, west: 6 });
    expect(dealers.faces).toEqual({});
  });

  // PID-452: the pool never leaks; the dealer's count comes once they are down to six.
  it('counts what the dealer took only once they have thrown', () => {
    expect(plan.frames.at(-2).drew).toEqual({ north: 5, east: 3, south: 4 });
    expect(plan.frames.at(-1).drew).toEqual({ north: 5, east: 3, south: 4, west: 4 });
    expect(drewAt(plan.frames.at(-1), model)).toEqual({ north: 5, east: 3, south: 4, west: 4 });
    // Still picking: the table waits on this frame, and says nothing of the dealer's.
    const picking = { ...model, seats: { ...model.seats, west: seat(null, null, 9) } };
    expect(drewAt(plan.frames.at(-1), picking)).toEqual({ north: 5, east: 3, south: 4 });
  });

  it('counts +0 for a player who drew nothing, their pile lying until the dealer passes them', () => {
    // East kept seven: nothing to draw. North (the dealer's left) is given five first.
    const kept7 = { ...model, seats: { ...model.seats, east: seat(7, 0, 7, 2) } };
    const frames = makePlan(kept7, held).frames;
    const southFirst = frames.findIndex((frame) => frame.drawn.south > 0);
    expect(frames[southFirst - 1].thrown.east).toBe(2);
    expect(frames[southFirst].thrown.east).toBe(0);
    expect(frames[southFirst].drew).toEqual({ north: 5, east: 0, south: 4 });
  });
});

describe('the second deal when you deal', () => {
  const model = {
    phase: 'playing',
    dealerRelative: 'south',
    yourHand: held.slice(0, 2),
    seats: {
      north: seat(1, 5, 6),
      east: seat(3, 3, 6),
      west: seat(4, 2, 6),
      south: seat(null, null, 6),
    },
  };

  it('has the others throw and be dealt; you throw nothing anyone sees', () => {
    const plan = makePlan(model, held);
    expect(plan.yourThrown).toBeNull();
    expect(plan.frames.every((frame) => frame.thrown.south === 0)).toBe(true);
    expect(
      plan.frames
        .slice(1, 4)
        .map((frame) => Object.entries(frame.thrown).filter(([, n]) => n > 0).length)
    ).toEqual([1, 2, 3]);
    expect(plan.frames.at(-1).hand).toEqual({ north: 6, east: 6, south: 9, west: 6 });
  });
});

describe('your own throw when you deal (PID-306)', () => {
  // You took up eleven and kept six: the five you let go show only to you.
  const pool = [...held.slice(0, 9), card(5, 'spades'), card(2, 'clubs')].map((c) => c.card);
  const kept = [0, 1, 3, 5, 9, 8].map((i) => pool[i]);
  const model = {
    phase: 'playing',
    dealerRelative: 'south',
    yourHand: [],
    seats: {
      north: seat(1, 5, 6, 8),
      east: seat(3, 3, 6, 6),
      west: seat(4, 2, 6, 5),
      south: seat(null, null, 6, 5),
    },
  };
  const plan = makePlan(model, held);
  const last = plan.frames.at(-1);

  it('lays the pool you were shown, less the six you kept, face up in front of you', () => {
    const thrown = dealerThrow(pool, kept);
    expect(thrown.map((c) => `${c.suit}_${c.rank}`)).toEqual([
      'hearts_13',
      'clubs_4',
      'clubs_7',
      'diamonds_3',
      'clubs_2',
    ]);
    const show = showAt(last, model, thrown);
    expect(show.thrown.south).toBe(5);
    expect(show.faces.south).toEqual(thrown);
  });

  it('shows backs without your pick, or when it does not add up to the server’s count', () => {
    expect(dealerThrow(undefined, kept)).toBeNull();
    expect(showAt(last, model, null).faces.south).toBeUndefined();
    const short = showAt(last, model, dealerThrow(pool.slice(0, 9), kept));
    expect(short.thrown.south).toBe(5);
    expect(short.faces.south).toBeUndefined();
  });
});
