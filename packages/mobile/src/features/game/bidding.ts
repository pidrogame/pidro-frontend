import { t, type ServerGameState } from '@pidro/shared';

/**
 * The bidding the table shows (PID-267). While the deal plays, nobody has bid
 * yet, even a bot that already has: everyone decides once they hold all nine.
 * What came meanwhile shows, in order, when the deal ends.
 */
export function bidsShown(state: ServerGameState | null, dealing: boolean) {
  return dealing && state
    ? { ...state, bids: undefined, bid_order: undefined, highest_bid: undefined }
    : state;
}

/**
 * A seat's line while the hand is bid (PID-214). Every seat keeps its bid
 * until bidding ends, and whoever holds the high bid says so, so the round
 * reads at a glance where the plaque's ticker is left out. `short` is the line
 * for a seat with no name beside it (yours on a small phone). `pulse` names
 * the bid itself: it changes when the seat bids, not when somebody outbids it.
 */
export type BidSeatLine = {
  text: string;
  short: string;
  tone?: 'now' | 'quiet' | 'high';
  pulse?: string;
};

export function bidSeatLine({
  bid,
  holdsHigh,
  onTurn,
  hand,
}: {
  bid: number | 'pass' | null | undefined;
  holdsHigh: boolean;
  onTurn: boolean;
  hand?: number | null;
}): BidSeatLine | null {
  const pulse = `${hand ?? 0}:${bid}`;
  if (bid === 'pass')
    return { text: t('game.passed'), short: t('game.passed'), tone: 'quiet', pulse };
  if (typeof bid === 'number') {
    return holdsHigh
      ? {
          text: t('game.bid_high', { amount: bid }),
          short: t('game.bid_high_short', { amount: bid }),
          tone: 'high',
          pulse,
        }
      : { text: t('game.bid', { amount: bid }), short: t('game.bid', { amount: bid }), pulse };
  }
  return onTurn ? { text: t('game.bidding'), short: t('game.bidding'), tone: 'now' } : null;
}

/** How long the bidding's winner keeps saying their bid once it ends (PID-450). */
export const BID_HOLD_MS = 1500;

/**
 * The bidding's winner, for a beat once it ends (`BID_HOLD_MS`): their line
 * stays on their bid, in gold and off the turn's plate, before it turns to
 * choosing trump, so the table sees who won it.
 */
export function heldBidLine(amount: number | null | undefined): BidSeatLine | null {
  if (typeof amount !== 'number') return null;
  const text = t('game.bid', { amount });
  return { text, short: text, tone: 'high' };
}
