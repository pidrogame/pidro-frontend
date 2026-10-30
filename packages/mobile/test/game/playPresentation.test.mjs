import { describe, expect, it } from 'bun:test';
import { optimisticPlay, turnLight } from '../../src/features/game/playPresentation.ts';
import { buildTableModel } from '../../src/game/canvas/tableModel.ts';

const hand = [
  { suit: 'spades', rank: 14 },
  { suit: 'hearts', rank: 9 },
  { suit: 'clubs', rank: 3 },
];
const source = buildTableModel({
  phase: 'playing',
  trumpSuit: 'spades',
  players: [],
  yourHand: hand,
  yourCardCount: 3,
  currentTrick: [],
  tricks: [],
  legalActions: hand.map((card) => ({ type: 'play_card', card })),
  currentTurnRelative: 'south',
  canPlay: true,
  getCardCountForPlayer: () => 3,
});

describe('optimistic play is presentation only', () => {
  it('moves the selected card, closes its gap, then restores the exact server hand on rejection or timeout', () => {
    for (const card of source.yourHand) {
      const pending = { card, startedAt: 1000, rejected: false };
      const view = optimisticPlay(source, pending, 1001);
      expect(view.yourHand).toEqual(source.yourHand.filter((c) => c !== card));
      expect(view.playedCards.south.map((c) => c.key)).toEqual([card.key]);
      expect(view.canPlay).toBe(false);
      expect(view.currentTrick).toBe(source.currentTrick);
      expect(view.lastTrick).toBe(source.lastTrick);
      expect(source.yourHand.map((c) => c.card)).toEqual(hand);
      expect(source.playedCards).toEqual({});
      expect(optimisticPlay(source, { ...pending, rejected: true }, 1100)).toBe(source);
      expect(optimisticPlay(source, pending, 5999)).not.toBe(source);
      expect(optimisticPlay(source, pending, 6000)).toBe(source);
      expect(optimisticPlay({ ...source, phase: 'bidding' }, pending, 1001).playedCards).toEqual(
        {}
      );
    }
  });

  it('uses confirmation once, even after a timeout or rejection', () => {
    const card = source.yourHand[2];
    const confirmed = {
      ...source,
      yourHand: source.yourHand.slice(0, 2),
      playedCards: { south: [{ ...card, key: 'server-trick-card' }] },
    };
    for (const rejected of [false, true]) {
      for (const now of [1100, 7000]) {
        expect(optimisticPlay(confirmed, { card, startedAt: 1000, rejected }, now)).toBe(confirmed);
      }
    }
  });
});

describe('turn-light presentation', () => {
  const timing = {
    turn: 'west',
    previousTurn: 'south',
    landsAt: 1340,
    collectUntil: 0,
    pending: false,
  };
  it('keeps the old seat until landing, then uses only the server seat', () => {
    expect(turnLight({ ...timing, now: 1339 })).toBe('south');
    expect(turnLight({ ...timing, now: 1340 })).toBe('west');
    expect(turnLight({ ...timing, now: 1340, turn: null })).toBeNull();
    expect(turnLight({ ...timing, now: 1340, pending: true })).toBeNull();
  });
  it('extinguishes every seat through a completed trick, even if the server skips the winner', () => {
    for (const now of [1000, 1339, 1340, 2499]) {
      expect(turnLight({ ...timing, turn: 'east', collectUntil: 2500, now })).toBeNull();
    }
    expect(turnLight({ ...timing, turn: 'east', collectUntil: 2500, now: 2500 })).toBe('east');
    // Reduced motion lands immediately, but does not skip the server's reading time.
    expect(turnLight({ ...timing, landsAt: 0, collectUntil: 2500, now: 1000 })).toBeNull();
    expect(turnLight({ ...timing, landsAt: 0, now: 1000 })).toBe('west');
  });
});
