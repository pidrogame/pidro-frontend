import { describe, expect, it } from 'bun:test';
import { dealerThrow, makePlan, showAt } from '../../src/game/canvas/secondDealPlan.ts';
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

  it('holds the piles to count, then clears them before the refill', () => {
    expect(beats[3].ms).toBe(secondDealTiming.holdMs);
    expect(beats[4].thrown).toEqual({ north: 0, east: 0, south: 0, west: 0 });
    expect(beats[4].pack).toBe(16);
  });

  it('deals one card at a time, player by player, and the dealer takes the rest', () => {
    const order = beats.slice(5, -1).map((frame, i, all) => {
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

  it('takes as long as the server holds play for, less the dealer’s throw it does not count', () => {
    const total = beats.reduce((sum, frame) => sum + frame.ms, 0);
    expect(total).toBe(secondDealDurationMs(12) - secondDealTiming.dealerHoldMs);
    expect(beats.some((frame) => frame.dealerThrew)).toBe(false);
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
    expect(plan.frames.map((frame) => !!frame.dealerThrew)).toEqual([
      ...Array(plan.frames.length - 1).fill(false),
      true,
    ]);
  });

  it('shows you your own throw face up, and the dealer’s as backs to count', () => {
    const yourThrow = showAt(plan.frames[3], model, plan, null);
    expect(yourThrow.thrown.south).toBe(7);
    expect(yourThrow.faces.south.map((c) => `${c.suit}_${c.rank}`)).toEqual([
      'hearts_13',
      'diamonds_8',
      'clubs_4',
      'hearts_12',
      'clubs_7',
      'diamonds_3',
      'hearts_9',
    ]);
    expect(yourThrow.faces.north).toBeUndefined();
    expect(yourThrow.thrown.west).toBe(0);

    const dealers = showAt(plan.frames.at(-1), model, plan, null);
    expect(dealers.thrown).toEqual({ north: 0, east: 0, south: 0, west: 6 });
    expect(dealers.faces).toEqual({});
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
    const show = showAt(last, model, plan, thrown);
    expect(show.thrown.south).toBe(5);
    expect(show.faces.south).toEqual(thrown);
  });

  it('shows backs without your pick, or when it does not add up to the server’s count', () => {
    expect(dealerThrow(undefined, kept)).toBeNull();
    expect(showAt(last, model, plan, null).faces.south).toBeUndefined();
    const short = showAt(last, model, plan, dealerThrow(pool.slice(0, 9), kept));
    expect(short.thrown.south).toBe(5);
    expect(short.faces.south).toBeUndefined();
  });
});

describe('an older server, which counts no throws', () => {
  // Today's table: your own pile stays face down too.
  const model = {
    phase: 'playing',
    dealerRelative: 'west',
    yourHand: held.slice(0, 2),
    seats: {
      north: seat(1, 5, 6),
      east: seat(3, 3, 6),
      south: seat(2, 4, 6),
      west: seat(null, null, 6),
    },
  };
  const plan = makePlan(model, held);

  it('shows every pile as backs, yours included', () => {
    const yourThrow = showAt(plan.frames[3], model, plan, null);
    expect(yourThrow.thrown.south).toBe(7);
    expect(yourThrow.faces).toEqual({});
  });
});
