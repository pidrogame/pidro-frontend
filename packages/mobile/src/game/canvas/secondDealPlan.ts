/**
 * The second deal, frame by frame (`useSecondDealPresentation` plays them),
 * at Classic's pace: each player in turn from the dealer's left throws down
 * to their trumps in one swoop, the piles hold to be counted and clear, the
 * dealer gives each player their cards one at a time, then takes the rest
 * and, once down to six, throws too (PID-306; a server that does not count
 * the dealer's throw leaves it unseen). Pure: built only from the server's
 * counts and hands.
 */
import type { Card } from '@/types/game';
import type { RelativePosition } from './layout';
import type { TableCard, TableModel } from './tableModel';
import { SECOND_DEAL_PACK, secondDealTiming } from './animationTiming';

export const CLOCKWISE: RelativePosition[] = ['north', 'east', 'south', 'west'];
export const BEFORE = new Set(['bidding', 'declaring', 'discarding']);
export const AFTER = new Set(['second_deal', 'playing']);
export const DEALT = 9;

export type Counts = Partial<Record<RelativePosition, number>>;

/** What the table shows while the second deal plays out. */
export type SecondDealShow = {
  /** Cards still in the pack in the middle. */
  pack: number;
  /** Cards each player has thrown in front of them, face down. */
  thrown: Counts;
  /** The faces of a pile only its thrower sees (PID-306): yours. */
  faces?: Partial<Record<RelativePosition, Card[]>>;
};

export type Frame = SecondDealShow & {
  /** Cards each player has thrown so far, the piles cleared or not. */
  out: Counts;
  /** Cards each seat has been given so far. */
  drawn: Counts;
  /** Backs in each opponent's hand. */
  hand: Counts;
  /** How long this frame holds before the next. */
  ms: number;
  /** The dealer has taken the pack and thrown down to six: their pile shows. */
  dealerThrew?: boolean;
};

export type Plan = {
  frames: Frame[];
  /** Your own hand: what you threw, in order, and what you were given. */
  yourThrown: TableCard[] | null;
  yourDrawn: TableCard[] | null;
};

export function makePlan(model: TableModel, held: TableCard[] | null): Plan | null {
  const dealer = model.dealerRelative;
  if (!dealer) return null;
  const t = secondDealTiming;
  const kept: Counts = {};
  const drawn: Counts = {};
  // Only the players dealt to are counted here; the dealer's throw comes last.
  for (const rel of CLOCKWISE) {
    const seat = model.seats[rel];
    if (!seat || rel === dealer) continue;
    if (!seat.secondDeal) {
      if (rel === 'south') continue;
      return null;
    }
    kept[rel] = seat.secondDeal.kept;
    drawn[rel] = seat.secondDeal.drawn ?? 0;
  }
  // Your own cards say what you threw and drew: the ones you held stay.
  let yourThrown: TableCard[] | null = null;
  let yourDrawn: TableCard[] | null = null;
  if (dealer !== 'south' && held && held.length > 0 && model.yourHand.length > 0) {
    const now = new Set(model.yourHand.map((card) => card.textureKey));
    const before = new Set(held.map((card) => card.textureKey));
    yourThrown = held.filter((card) => !now.has(card.textureKey));
    yourDrawn = model.yourHand.filter((card) => !before.has(card.textureKey));
    kept.south = held.length - yourThrown.length;
    drawn.south = yourDrawn.length;
  }
  if (dealer !== 'south' && kept.south == null) kept.south = model.seats.south?.secondDeal?.kept;
  if (dealer !== 'south' && kept.south == null) return null;

  const start = CLOCKWISE.indexOf(dealer) + 1;
  const players = [0, 1, 2].map((i) => CLOCKWISE[(start + i) % 4]);
  const dealt = players.reduce((sum, rel) => sum + (drawn[rel] ?? 0), 0);
  const rest = Math.max(0, SECOND_DEAL_PACK - dealt);

  const frames: Frame[] = [];
  const hand: Counts = {};
  const thrown: Counts = {};
  const out: Counts = {};
  const given: Counts = {};
  for (const rel of CLOCKWISE) {
    if (!model.seats[rel]) continue;
    hand[rel] = DEALT;
    thrown[rel] = 0;
  }
  let pack = 0;
  const push = (ms: number) =>
    frames.push({
      hand: { ...hand },
      thrown: { ...thrown },
      out: { ...out },
      drawn: { ...given },
      pack,
      ms,
    });

  push(t.startMs);
  // Each player in turn throws down to their trumps, in one swoop.
  players.forEach((rel, index) => {
    if (hand[rel] == null) return;
    thrown[rel] = DEALT - (kept[rel] ?? DEALT);
    out[rel] = thrown[rel];
    hand[rel] = kept[rel] ?? DEALT;
    push(index === players.length - 1 ? t.holdMs : t.throwGapMs);
  });
  // The piles clear; the pack waits in its corner.
  for (const rel of players) thrown[rel] = 0;
  pack = dealt + rest;
  push(t.packMs);
  // The dealer gives each player their cards, one at a time.
  const receiving = players.filter((rel) => (drawn[rel] ?? 0) > 0);
  receiving.forEach((rel, index) => {
    const n = drawn[rel] ?? 0;
    for (let k = 0; k < n; k++) {
      hand[rel] = (hand[rel] ?? 0) + 1;
      given[rel] = (given[rel] ?? 0) + 1;
      pack -= 1;
      // A breath between one player's cards and the next player's.
      const between = k === n - 1 && index < receiving.length - 1;
      push(between ? t.cardMs + t.seatGapMs : t.cardMs);
    }
  });
  // The dealer takes the rest, unseen: their hand keeps its look until they
  // throw. A server that counts throws (PID-306) shows the dealer's last.
  pack = 0;
  push(t.robMs);
  if (players.some((rel) => model.seats[rel]?.discarded != null)) {
    frames.push({ ...frames[frames.length - 1], dealerThrew: true, ms: t.dealerHoldMs });
  }
  return { frames, yourThrown, yourDrawn };
}

/**
 * What the table shows at `frame` (PID-306). Everyone sees how many each
 * player threw, the dealer's once down to six; only the thrower sees the
 * faces: yours when you were dealt to, and when you deal, `dealt` (the pool
 * you were shown less the six you kept). An older server shows only backs.
 */
export function showAt(
  frame: Frame,
  model: TableModel,
  plan: Plan,
  dealt: Card[] | null
): SecondDealShow {
  const dealer = model.dealerRelative;
  const thrown = { ...frame.thrown };
  const faces: SecondDealShow['faces'] = {};
  const counted = model.seats.south?.discarded != null;
  const yours = plan.yourThrown ?? [];
  if (counted && yours.length > 0 && thrown.south === yours.length)
    faces.south = yours.map((c) => c.card);
  if (frame.dealerThrew && dealer) {
    thrown[dealer] = model.seats[dealer]?.discarded ?? 0;
    if (dealer === 'south' && dealt && dealt.length > 0 && dealt.length === thrown.south)
      faces.south = dealt;
  }
  return { pack: frame.pack, thrown, faces };
}

/** The cards you threw as dealer: the pool you were shown less the six you kept. */
export function dealerThrow(pool: Card[] | undefined, kept: Card[] | undefined): Card[] | null {
  if (!pool || !kept) return null;
  const key = (c: Card) => `${c.suit}_${c.rank}`;
  const keep = new Set(kept.map(key));
  return pool.filter((c) => !keep.has(key(c)));
}
