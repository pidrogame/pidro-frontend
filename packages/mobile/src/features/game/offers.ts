import type { Said, TalkItem } from './talk';

/**
 * What the band offers to say (PID-328). The server names a moment; someone
 * else saying something offers its answer. Kind words only (Chat-Moments).
 */
export interface Offer {
  /** The card, and a second word where the moment has no faces. */
  words: TalkItem[];
  coins: TalkItem[];
}

export type MomentId = 'start' | 'partner_trick' | 'game_end';

const MOMENTS: Record<MomentId, Offer> = {
  start: { words: ['word_hello', 'word_luck'], coins: [] },
  partner_trick: { words: ['word_nice'], coins: ['coin_heart', 'coin_thumb'] },
  game_end: { words: ['word_game'], coins: ['coin_heart'] },
};

export function momentOffer(id: unknown): Offer | null {
  return typeof id === 'string' && Object.hasOwn(MOMENTS, id) ? MOMENTS[id as MomentId] : null;
}

/** Praise answers Thanks, sorry answers No worries, a greeting answers itself. */
const REPLIES: Partial<Record<TalkItem, Offer>> = {
  word_nice: { words: ['word_thanks'], coins: ['coin_heart'] },
  word_well: { words: ['word_thanks'], coins: ['coin_heart'] },
  word_bid: { words: ['word_thanks'], coins: ['coin_heart'] },
  word_sorry: { words: ['word_noworries'], coins: ['coin_heart'] },
  word_oops: { words: ['word_noworries'], coins: ['coin_heart'] },
  word_hello: { words: ['word_hello'], coins: [] },
  word_luck: { words: ['word_luck'], coins: [] },
  word_game: { words: ['word_game'], coins: ['coin_heart'] },
};

export function replyOffer(said: Pick<Said, 'item'>): Offer | null {
  return (said.item && REPLIES[said.item]) || null;
}

/** How long an offer stays before it counts as ignored. */
export const OFFER_MS = 6_000;
const IGNORED_LIMIT = 3;

/**
 * At most one offer a trick; ignore three in a row and offers wait for the
 * end of the hand. Only greetings during bidding: other words after a bid
 * could hint at cards.
 */
export interface OfferPace {
  /** The trick the last offer came in. */
  trick: string | null;
  ignored: number;
  /** The hand offers wait out, once three went unanswered. */
  hushed: number | null;
}

export const FRESH_PACE: OfferPace = { trick: null, ignored: 0, hushed: null };

const GREETINGS: TalkItem[] = ['word_hello', 'word_luck'];

export function mayOffer(
  pace: OfferPace,
  at: { hand: number; trick: string; bidding: boolean },
  offer: Offer
): boolean {
  const greeting = offer.words.every((word) => GREETINGS.includes(word));
  return (greeting || !at.bidding) && pace.trick !== at.trick && pace.hushed !== at.hand;
}

export const offered = (pace: OfferPace, trick: string): OfferPace => ({ ...pace, trick });
export const answered = (pace: OfferPace): OfferPace => ({ ...pace, ignored: 0 });
export function ignored(pace: OfferPace, hand: number): OfferPace {
  const count = pace.ignored + 1;
  return count >= IGNORED_LIMIT
    ? { ...pace, ignored: 0, hushed: hand }
    : { ...pace, ignored: count };
}
