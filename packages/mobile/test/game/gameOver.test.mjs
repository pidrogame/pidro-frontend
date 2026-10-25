import { describe, expect, it } from 'bun:test';
import {
  bestHand,
  bestHandLine,
  lastTrickReveal,
  raceLine,
  othersAreBots,
  rematchLines,
  streakChip,
  xpChip,
} from '../../src/features/game/gameOver.ts';

const point = (rank, suit, team) => ({
  card: { rank, suit },
  points: rank === 5 ? 5 : 1,
  position: team === 'north_south' ? 'south' : 'east',
  team,
});

const hand = (number, ns, ew, extra = {}) => ({
  hand_number: number,
  bidding_team: 'north_south',
  bidder: 'south',
  bid: 6,
  captured: { north_south: 7, east_west: 7 },
  made: true,
  delta: { north_south: ns, east_west: ew },
  scores: { north_south: 0, east_west: 0 },
  trump: 'spades',
  point_cards: [],
  ...extra,
});

describe('your best hand', () => {
  it('is the hand where your team gained the most, whichever team you sit on', () => {
    const history = [hand(1, 6, -6), hand(2, -9, 11), hand(3, 12, 2), hand(4, 3, 8)];
    expect(bestHand(history, 'north_south')?.hand_number).toBe(3);
    expect(bestHand(history, 'east_west')?.hand_number).toBe(2);
  });

  it('is nothing when your team never gained', () => {
    expect(bestHand([hand(1, -6, 8), hand(2, 0, 9)], 'north_south')).toBeNull();
    expect(bestHand([], 'north_south')).toBeNull();
    expect(bestHand(undefined, 'north_south')).toBeNull();
  });

  it('names the bid, and the Pidros only when your team took both fives', () => {
    const both = hand(7, 12, 2, {
      bid: 11,
      point_cards: [
        point(14, 'spades', 'north_south'),
        point(5, 'spades', 'north_south'),
        point(5, 'clubs', 'north_south'),
        point(2, 'spades', 'east_west'),
      ],
    });
    expect(bestHandLine(both, 'north_south', 'Mikko')).toBe('Hand 7. You took both Pidros.');
    const split = hand(7, 6, 6, {
      bid: 8,
      trump: 'hearts',
      point_cards: [point(5, 'hearts', 'north_south'), point(5, 'diamonds', 'east_west')],
    });
    expect(bestHandLine(split, 'north_south', 'You')).toBe('Hand 7. You bid 8 ♥.');
    expect(bestHandLine(split, 'east_west', 'Eli')).toBe('Hand 7. Eli bid 8 ♥.');
    expect(bestHandLine({ ...split, trump: null }, 'east_west', 'Eli')).toBe('Hand 7. Eli bid 8.');
  });
});

describe('the last trick', () => {
  it('lifts the card that took it, between two of the others', () => {
    const tricks = [
      {
        winner: 'north',
        cards: [
          { player: 'east', card: { rank: 14, suit: 'hearts' } },
          { player: 'south', card: { rank: 2, suit: 'hearts' } },
          { player: 'west', card: { rank: 9, suit: 'hearts' } },
          { player: 'north', card: { rank: 5, suit: 'hearts' } },
        ],
      },
    ];
    expect(lastTrickReveal({ ...hand(10, 14, 0), tricks })).toEqual({
      winner: { rank: 5, suit: 'hearts' },
      others: [
        { rank: 14, suit: 'hearts' },
        { rank: 2, suit: 'hearts' },
      ],
    });
    expect(lastTrickReveal({ ...hand(10, 14, 0), tricks: [] })).toBeNull();
    expect(lastTrickReveal(null)).toBeNull();
  });
});

describe('how it went', () => {
  const totals = (pairs) =>
    pairs.map(([ns, ew], index) =>
      hand(index + 1, 0, 0, { scores: { north_south: ns, east_west: ew } })
    );

  it('marks the first hand of the lasting lead, from either seat', () => {
    const history = totals([
      [8, 6],
      [14, 4],
      [20, 26],
      [41, 41],
      [53, 29],
      [62, 29],
    ]);
    expect(raceLine(history, 'north_south')).toEqual({
      us: [0, 8, 14, 20, 41, 53, 62],
      them: [0, 6, 4, 26, 41, 29, 29],
      turn: 5,
    });
    expect(raceLine(history, 'east_west').turn).toBe(5);
  });

  it('marks nothing when the winner led from the first hand, or nobody won', () => {
    expect(
      raceLine(
        totals([
          [6, 0],
          [30, 2],
          [62, 8],
        ]),
        'east_west'
      ).turn
    ).toBeNull();
    expect(
      raceLine(
        totals([
          [6, 0],
          [62, 62],
        ]),
        'north_south'
      ).turn
    ).toBeNull();
  });
});

describe('the rematch row', () => {
  const others = (agreed, bots = []) =>
    ['Nora', 'Kalle', 'Mikko'].map((name) => ({
      name,
      bot: bots.includes(name),
      agreed: bots.includes(name) || agreed.includes(name),
    }));

  it('says nothing until somebody asks', () => {
    expect(rematchLines(others([]), false)).toEqual({ title: null, detail: null });
  });

  it('names who asked and who it waits on', () => {
    expect(rematchLines(others(['Nora']), false)).toEqual({
      title: 'Nora wants a rematch',
      detail: 'Waiting for Kalle and Mikko',
    });
    expect(rematchLines(others(['Nora', 'Mikko']), false)).toEqual({
      title: 'Nora and Mikko want a rematch',
      detail: 'Waiting for Kalle',
    });
    expect(rematchLines(others(['Nora', 'Kalle', 'Mikko']), false)).toEqual({
      title: 'Nora, Kalle and Mikko want a rematch',
      detail: 'Waiting for you',
    });
  });

  it('after you agreed, says you are in and who is left, whoever asked first', () => {
    expect(rematchLines(others([]), true)).toEqual({
      title: "You're in",
      detail: 'Waiting for Nora, Kalle and Mikko',
    });
    expect(rematchLines(others(['Nora']), true)).toEqual({
      title: "You're in",
      detail: 'Waiting for Kalle and Mikko',
    });
    expect(rematchLines(others(['Nora', 'Kalle', 'Mikko']), true)).toEqual({
      title: "You're in",
      detail: null,
    });
  });

  it('counts bots as in without having them ask', () => {
    expect(rematchLines(others([], ['Kalle', 'Mikko']), true)).toEqual({
      title: "You're in",
      detail: 'Waiting for Nora',
    });
    expect(rematchLines(others(['Nora'], ['Kalle', 'Mikko']), false)).toEqual({
      title: 'Nora wants a rematch',
      detail: 'Waiting for you',
    });
  });

  it('is not shown when everyone else is a bot, only when a person sits with you', () => {
    expect(othersAreBots(others([], ['Nora', 'Kalle', 'Mikko']))).toBe(true);
    expect(othersAreBots(others([], ['Kalle', 'Mikko']))).toBe(false);
    expect(othersAreBots(others([]))).toBe(false);
    expect(othersAreBots([])).toBe(false);
  });
});

describe('the chips', () => {
  it('shows a streak from two wins in a row with this partner', () => {
    expect(streakChip({ display_name: 'Nora', wins_in_a_row: 3 })).toEqual({
      count: 3,
      name: 'Nora',
    });
    expect(streakChip({ display_name: 'Nora', wins_in_a_row: 2 })?.count).toBe(2);
    expect(streakChip({ display_name: 'Nora', wins_in_a_row: 1 })).toBeNull();
    expect(streakChip({ display_name: 'Nora', wins_in_a_row: 0 })).toBeNull();
    expect(streakChip(null)).toBeNull();
  });

  it('shows the XP the game earned', () => {
    expect(
      xpChip({ xp_earned: 126, veteran_progress: { into: 260, span: 500, max: false } })
    ).toEqual({ xp: 126 });
    expect(xpChip({ xp_earned: 64 })).toEqual({ xp: 64 });
    expect(xpChip(null)).toBeNull();
  });
});
