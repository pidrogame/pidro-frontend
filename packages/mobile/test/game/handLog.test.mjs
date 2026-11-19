import { afterEach, describe, expect, it } from 'bun:test';
import { setLocale } from '@pidro/shared';
import { buildHandLog, handLogEntries } from '../../src/game/handLog.ts';

const NAMES = { north: 'Kai', east: 'Eli', south: 'Mia', west: 'Nora' };

/** Seats as the view model hands them over; the viewer sits South unless told otherwise. */
const players = (you = 'south') =>
  ['north', 'east', 'south', 'west'].map((absolutePosition) => ({
    absolutePosition,
    username: NAMES[absolutePosition],
    isYou: absolutePosition === you,
  }));

const card = (rank, suit) => ({ rank, suit });
const play = (player, rank, suit) => ({ player, card: card(rank, suit) });

const build = (overrides = {}) =>
  buildHandLog({
    handNumber: 2,
    bids: [],
    trump: null,
    tricks: [],
    currentTrick: [],
    lastHand: null,
    players: players(),
    ...overrides,
  });

const texts = (groups) => handLogEntries(groups).map((entry) => entry.text);

const trickTo = (winner, points, twoOfTrump = null, plays = null) => ({
  cards: plays ?? [
    play('north', 13, 'spades'),
    play('east', 5, 'spades'),
    play('south', 9, 'spades'),
    play('west', 4, 'spades'),
  ],
  winner,
  points,
  two_of_trump: twoOfTrump,
});

describe('buildHandLog', () => {
  afterEach(() => setLocale('en'));
  it('lists bids in the order the server made them, with "You" for the viewer', () => {
    const groups = build({
      bids: [
        { position: 'east', amount: 6 },
        { position: 'south', amount: 'pass' },
        { position: 'west', amount: 7 },
      ],
    });
    expect(texts(groups)).toEqual(['Eli bid 6', 'You passed', 'Nora bid 7']);
  });

  it('shows no bids when the order is unknown', () => {
    expect(texts(build({ bids: undefined, trump: 'spades' }))).toEqual(['Trump ♠']);
  });

  it('reads a taken trick and the 2 of trump in the server’s numbers', () => {
    const groups = build({
      trump: 'spades',
      tricks: [trickTo('east', 5, { position: 'south', points: 1 })],
    });
    expect(texts(groups).slice(-2)).toEqual(['They won the trick +5', 'Your 2 of trump +1']);
  });

  // PID-481: one line per seat that killed, highest first, after trump and before the first play.
  it('says who killed which trumps over six, as the seats are named elsewhere', () => {
    const killed = {
      west: [card(4, 'hearts'), card(7, 'hearts')],
      south: [card(13, 'hearts')],
      north: [],
    };
    const groups = build({
      trump: 'hearts',
      killed,
      currentTrick: [play('east', 14, 'hearts')],
    });
    expect(texts(groups)).toEqual([
      'Trump ♥',
      'You killed K♥',
      'Nora killed 7♥ 4♥',
      'Eli plays A♥',
    ]);
    const entries = handLogEntries(groups);
    expect(entries.filter((entry) => entry.kind === 'kill')).toMatchObject([
      { id: 'kill-2-south', ours: true, trick: null },
      { id: 'kill-2-west', who: 'Nora', ours: false, trick: null },
    ]);
    // A seat without a name is its position, as in every other line.
    const seats = players().map((p) =>
      p.absolutePosition === 'west' ? { ...p, username: null } : p
    );
    expect(
      texts(build({ players: seats, killed, currentTrick: [play('west', 9, 'hearts')] }))
    ).toEqual(['You killed K♥', 'west killed 7♥ 4♥', 'west plays 9♥']);
    setLocale('sv');
    expect(texts(build({ killed }))).toEqual(['Du dödade K♥', 'Nora dödade 7♥ 4♥']);
    expect(texts(build({ players: seats, killed }))).toContain('väster dödade 7♥ 4♥');
    // Nothing killed, or an older server: no line.
    expect(texts(build({ killed: {} }))).toEqual([]);
    expect(texts(build({ killed: null }))).toEqual([]);
    // A malformed entry is left out, never thrown on (still in Swedish).
    expect(texts(build({ killed: { north: [null, card(3, 'hearts')], east: 'x' } }))).toEqual([
      'Kai dödade 3♥',
    ]);
  });

  it('marks your side’s lines as ours', () => {
    const entries = handLogEntries(
      build({ tricks: [trickTo('north', 3, { position: 'west', points: 1 })] })
    );
    const taken = entries.find((entry) => entry.kind === 'trick');
    const two = entries.find((entry) => entry.kind === 'two');
    expect(taken).toMatchObject({ text: 'We won the trick +3', ours: true });
    expect(two).toMatchObject({ text: "Nora's 2 of trump +1", ours: false });
  });

  it('leaves out "+0" when a trick holds nothing', () => {
    expect(texts(build({ tricks: [trickTo('east', 0)] })).at(-1)).toBe('They won the trick');
  });

  it('keeps a short trick short once seats have gone cold', () => {
    const entries = handLogEntries(
      build({
        tricks: [trickTo('west', 1, null, [play('east', 8, 'hearts'), play('west', 14, 'hearts')])],
      })
    );
    expect(entries.map((entry) => entry.kind)).toEqual(['play', 'play', 'trick']);
    expect(entries[1].text).toBe('Nora plays A♥');
  });

  it('adds the trick in progress after the finished ones, with ids that do not move', () => {
    const before = handLogEntries(
      build({
        tricks: [trickTo('east', 0)],
        currentTrick: [play('east', 10, 'clubs'), play('south', 3, 'clubs')],
      })
    );
    const after = handLogEntries(
      build({
        tricks: [trickTo('east', 0)],
        currentTrick: [
          play('east', 10, 'clubs'),
          play('south', 3, 'clubs'),
          play('west', 7, 'clubs'),
        ],
      })
    );
    expect(before.slice(-2).map((entry) => entry.text)).toEqual(['Eli plays 10♣', 'You play 3♣']);
    expect(after.slice(0, before.length).map((entry) => entry.id)).toEqual(
      before.map((entry) => entry.id)
    );
    expect(after.at(-1).trick).toBe(2);
  });

  it('uses table sides for spectators', () => {
    const groups = build({ players: players(null), tricks: [trickTo('east', 2)] });
    expect(texts(groups).at(-1)).toBe('E/W won the trick +2');
  });

  it('puts the whole last hand first between hands, final trick included', () => {
    const lastHand = {
      hand_number: 3,
      bidding_team: 'north_south',
      bidder: 'north',
      bid: 7,
      captured: { north_south: 9, east_west: 5 },
      made: true,
      delta: { north_south: 9, east_west: 5 },
      scores: { north_south: 30, east_west: 21 },
      bids: [{ position: 'north', amount: 7 }],
      trump: 'hearts',
      tricks: [trickTo('north', 9), trickTo('east', 5)],
    };
    const groups = build({ handNumber: 4, lastHand, bids: [{ position: 'east', amount: 6 }] });
    expect(groups.map((group) => group.hand)).toEqual([3, 4]);
    expect(groups[0].finished).toBe(true);
    expect(texts([groups[0]])).toEqual([
      'Kai bid 7',
      'Trump ♥',
      'Kai plays K♠',
      'Eli plays 5♠',
      'You play 9♠',
      'Nora plays 4♠',
      'We won the trick +9',
      'Kai plays K♠',
      'Eli plays 5♠',
      'You play 9♠',
      'Nora plays 4♠',
      'They won the trick +5',
      'We made it +9',
    ]);
    expect(texts([groups[1]])).toEqual(['Eli bid 6']);
  });

  it('shares ids between a trick in progress and the same trick in the last hand', () => {
    const live = handLogEntries(
      build({ handNumber: 3, tricks: [], currentTrick: [play('north', 13, 'spades')] })
    );
    const after = handLogEntries(
      build({
        handNumber: 4,
        lastHand: {
          hand_number: 3,
          bidding_team: 'east_west',
          bidder: 'east',
          bid: 6,
          captured: { north_south: 1, east_west: 3 },
          made: false,
          delta: { north_south: 1, east_west: -6 },
          scores: { north_south: 10, east_west: 4 },
          tricks: [trickTo('east', 0)],
        },
      })
    );
    expect(after.map((entry) => entry.id)).toContain(live[0].id);
    expect(after.at(-1).text).toBe('They missed it -6');
  });

  it('shows only the result for a last hand from an older server', () => {
    const groups = build({
      handNumber: 4,
      lastHand: {
        hand_number: 3,
        bidding_team: 'north_south',
        bidder: 'south',
        bid: 6,
        captured: { north_south: 4, east_west: 10 },
        made: false,
        delta: { north_south: -6, east_west: 10 },
        scores: { north_south: 0, east_west: 30 },
      },
    });
    expect(texts([groups[0]])).toEqual(['We missed it -6']);
  });

  it('adds the result to the same hand when the game ends without a reset', () => {
    const groups = build({
      handNumber: 5,
      tricks: [trickTo('south', 8)],
      lastHand: {
        hand_number: 5,
        bidding_team: 'north_south',
        bidder: 'south',
        bid: 6,
        captured: { north_south: 8, east_west: 6 },
        made: true,
        delta: { north_south: 8, east_west: 6 },
        scores: { north_south: 62, east_west: 40 },
        tricks: [trickTo('south', 8)],
      },
    });
    expect(groups).toHaveLength(1);
    expect(texts(groups).at(-1)).toBe('We made it +8');
    expect(texts(groups).filter((text) => text === 'We won the trick +8')).toHaveLength(1);
  });

  it('skips malformed pieces instead of throwing', () => {
    const groups = build({
      bids: [{ position: 'east', amount: 6 }, { amount: 7 }],
      tricks: [
        {
          cards: [{ player: 'east' }, play('nowhere', 3, 'clubs'), play('west', 2, 'clubs')],
          winner: 'west',
          points: 1,
        },
        null,
      ],
      currentTrick: 'oops',
    });
    expect(texts(groups)).toEqual(['Eli bid 6', 'Nora plays 2♣', 'They won the trick +1']);
  });

  it('builds the same ids and order from the same snapshot', () => {
    const input = {
      trump: 'spades',
      tricks: [trickTo('east', 5, { position: 'south', points: 1 })],
    };
    expect(handLogEntries(build(input))).toEqual(handLogEntries(build(input)));
  });
});
