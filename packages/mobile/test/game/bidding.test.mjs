import { afterEach, describe, expect, it } from 'bun:test';
import { setLocale } from '@pidro/shared';
import { seatPlate } from '../../src/features/game/seatLine.ts';
import { bidSeatLine, bidsShown, heldBidLine } from '../../src/features/game/bidding.ts';
import { buildHandLog, handLogEntries } from '../../src/game/handLog.ts';

const line = (overrides) =>
  bidSeatLine({ bid: undefined, holdsHigh: false, onTurn: false, hand: 4, ...overrides });

afterEach(() => setLocale('en'));

describe('a seat while the hand is bid', () => {
  it('keeps its bid, and says when it holds the high bid', () => {
    expect(line({ bid: 7 })).toEqual({ text: 'Bid 7', short: 'Bid 7', pulse: '4:7' });
    expect(line({ bid: 9, holdsHigh: true })).toEqual({
      text: 'Bid 9 · high',
      short: 'High 9',
      tone: 'high',
      pulse: '4:9',
    });
    expect(line({ bid: 'pass' })).toEqual({
      text: 'Passed',
      short: 'Passed',
      tone: 'quiet',
      pulse: '4:pass',
    });
  });

  it('pulses for the bid, not for being outbid', () => {
    expect(line({ bid: 9, holdsHigh: true }).pulse).toBe(line({ bid: 9 }).pulse);
    expect(line({ bid: 9 }).pulse).not.toBe(line({ bid: 9, hand: 5 }).pulse);
  });

  it('translates current bids without changing the bid event or high-bid tone', () => {
    for (const locale of ['en', 'sv', 'en']) {
      setLocale(locale);
      expect(line({ bid: 9, holdsHigh: true })).toEqual({
        text: locale === 'sv' ? 'Bud 9 · högst' : 'Bid 9 · high',
        short: locale === 'sv' ? 'Högst 9' : 'High 9',
        tone: 'high',
        pulse: '4:9',
      });
      expect(line({ bid: 7 }).text).toBe(locale === 'sv' ? 'Bud 7' : 'Bid 7');
      expect(line({ bid: 'pass' }).text).toBe(locale === 'sv' ? 'Passat' : 'Passed');
      expect(line({ onTurn: true }).text).toBe(locale === 'sv' ? 'Bjuder…' : 'Bidding…');
    }
  });

  it('says who is bidding, and nothing for a seat still waiting', () => {
    expect(line({ onTurn: true })).toEqual({ text: 'Bidding…', short: 'Bidding…', tone: 'now' });
    expect(line({})).toBeNull();
  });
});

describe('the bidding while the deal plays (PID-267)', () => {
  const players = ['north', 'east', 'south', 'west'].map((absolutePosition) => ({
    absolutePosition,
    username: { north: 'Antti', east: 'Jocke', south: 'Mia', west: 'Marcel' }[absolutePosition],
    isYou: absolutePosition === 'south',
  }));
  const served = (hand, order) => ({
    phase: 'bidding',
    hand_number: hand,
    current_player: 'south',
    players: {},
    bids: Object.fromEntries(order.map((bid) => [bid.position, bid.amount])),
    bid_order: order,
    ...(order.some((bid) => bid.amount !== 'pass') && {
      highest_bid: order.findLast((bid) => bid.amount !== 'pass'),
    }),
  });
  // What the table shows: the log's lines and East's seat.
  const table = (state, dealing) => {
    const shown = bidsShown(state, dealing);
    const log = buildHandLog({
      handNumber: shown.hand_number,
      bids: shown.bid_order,
      trump: null,
      tricks: [],
      currentTrick: [],
      lastHand: null,
      players,
    });
    const east = bidSeatLine({
      bid: shown.bids?.east,
      holdsHigh: shown.highest_bid?.position === 'east',
      onTurn: false,
      hand: shown.hand_number,
    });
    return { log: handLogEntries(log).map((entry) => entry.text), east: east?.text ?? null };
  };
  const round = [
    { position: 'west', amount: 'pass' },
    { position: 'north', amount: 7 },
    { position: 'east', amount: 9 },
  ];

  it('holds bids that arrive mid-deal, then shows them in order when it ends', () => {
    const midDeal = served(4, round);
    expect(table(midDeal, true)).toEqual({ log: [], east: null });
    expect(table(midDeal, false)).toEqual({
      log: ['Marcel passed', 'Antti bid 7', 'Jocke bid 9'],
      east: 'Bid 9 · high',
    });
  });

  it('shows a bid that arrives after the deal at once', () => {
    const after = served(4, round.slice(0, 1));
    expect(bidsShown(after, false)).toBe(after);
    expect(table(after, false).log).toEqual(['Marcel passed']);
  });

  it('holds again when the next hand is dealt', () => {
    expect(table(served(4, round), false).east).toBe('Bid 9 · high');
    const next = served(5, [{ position: 'east', amount: 6 }]);
    expect(table(next, true)).toEqual({ log: [], east: null });
    expect(table(next, false)).toEqual({ log: ['Jocke bid 6'], east: 'Bid 6 · high' });
  });

  it('keeps the rest of the table as the server sent it', () => {
    const midDeal = served(4, round);
    expect(bidsShown(midDeal, true)).toMatchObject({ phase: 'bidding', hand_number: 4 });
    expect(bidsShown(null, true)).toBeNull();
  });
});

describe('the bidding winner, held for a beat (PID-450)', () => {
  it('stays off the turn plate while held, and goes on it when it turns to trump', () => {
    expect(seatPlate(heldBidLine(9), { onTurn: true, isYou: false })).toBeNull();
    expect(
      seatPlate({ text: 'Choosing trump…', tone: 'now' }, { onTurn: true, isYou: false })
    ).toEqual({ plate: 'turn', text: 'Choosing trump…' });
  });

  it('holds nothing without a numeric bid', () => {
    expect(heldBidLine(null)).toBeNull();
    expect(heldBidLine(undefined)).toBeNull();
  });

  it('is in Swedish at a Swedish table', () => {
    setLocale('sv');
    expect(heldBidLine(14)?.text).toBe('Bud 14');
  });
});
