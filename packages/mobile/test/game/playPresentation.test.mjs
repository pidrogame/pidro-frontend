import { describe, expect, it } from 'bun:test';
import {
  blockedTapAnswer,
  optimisticPlay,
  turnLight,
} from '../../src/features/game/playPresentation.ts';
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
  it('keeps the sent card through a timeout, restoring it only on refusal or a changed turn', () => {
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
      expect(optimisticPlay(source, pending, 60_000)).not.toBe(source);
      const movedOn = { ...source, currentTurnRelative: 'east' };
      expect(optimisticPlay(movedOn, pending, 6000)).toBe(movedOn);
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

describe('a tap the table did not play (PID-364, PID-485)', () => {
  const calm = { inFlight: false, dealing: false, turn: 'north', answered: null };

  it('names the seat on turn on the first tap of a wait, and does nothing on the rest', () => {
    expect(blockedTapAnswer('not_your_turn', calm)).toBe('name');
    expect(blockedTapAnswer('not_your_turn', { ...calm, answered: 'north' })).toBe('nothing');
  });

  it('starts a new wait when the turn has moved to another seat', () => {
    expect(blockedTapAnswer('not_your_turn', { ...calm, turn: 'east', answered: 'north' })).toBe(
      'name'
    );
  });

  it('keeps a greyed card on your own turn wordless, and every tap of it shaking', () => {
    const yours = { ...calm, turn: 'south', answered: null };
    expect(blockedTapAnswer('invalid_action', yours)).toBe('nudge');
    expect(blockedTapAnswer('invalid_action', yours)).toBe('nudge');
    // A late "not your turn" on your own lit plate never names you.
    expect(blockedTapAnswer('not_your_turn', yours)).toBe('nudge');
  });

  it('does nothing while a finished trick settles and no seat is lit yet', () => {
    expect(blockedTapAnswer('not_your_turn', { ...calm, turn: null })).toBe('nothing');
    // A greyed card is still answered: it is your turn, only the card is wrong.
    expect(blockedTapAnswer('invalid_action', { ...calm, turn: null })).toBe('nudge');
  });

  it('does nothing while your card is on its way, the tap is pending, or the cards are dealt', () => {
    expect(blockedTapAnswer('pending', calm)).toBe('nothing');
    expect(blockedTapAnswer('not_your_turn', { ...calm, inFlight: true })).toBe('nothing');
    expect(blockedTapAnswer('invalid_phase', { ...calm, dealing: true })).toBe('nothing');
  });
});
