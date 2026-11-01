import type { TranslationKey } from '@pidro/shared';

/**
 * Table talk (PID-114): words are cards, faces are coins. Only the id travels,
 * so every player reads a word in their own language.
 */
export const TALK_COINS = ['coin_thumb', 'coin_heart', 'coin_ha', 'coin_oops', 'coin_wow'] as const;
/** The hand of words, in the order the sheet deals them. */
export const TALK_WORDS = [
  'word_nice',
  'word_well',
  'word_bid',
  'word_sorry',
  'word_oops',
  'word_thanks',
  'word_luck',
  'word_game',
  'word_hello',
] as const;
const ITEMS: readonly string[] = [...TALK_WORDS, ...TALK_COINS, 'word_noworries'];

export type TalkCoin = (typeof TALK_COINS)[number];
export type TalkItem = (typeof TALK_WORDS)[number] | TalkCoin | 'word_noworries';
export type Position = 'north' | 'east' | 'south' | 'west';

/** One thing said at the table: a word or a face, or (PID-318) typed text. */
export interface Said {
  seat: Position;
  userId: string;
  item?: TalkItem;
  text?: string;
}

export const isCoin = (item: TalkItem | undefined): item is TalkCoin =>
  !!item && item.startsWith('coin_');
export const talkKey = (item: TalkItem) => `talk.${item}` as TranslationKey;

const POSITIONS: readonly string[] = ['north', 'east', 'south', 'west'];

/** A `talk` push as the client trusts it; null for anything it cannot show. */
export function saidFrom(payload: unknown): Said | null {
  if (!payload || typeof payload !== 'object') return null;
  const { seat, user_id, item, text } = payload as Record<string, unknown>;
  if (typeof seat !== 'string' || !POSITIONS.includes(seat) || typeof user_id !== 'string')
    return null;
  if (typeof item === 'string' && ITEMS.includes(item))
    return { seat: seat as Position, userId: user_id, item: item as TalkItem };
  if (typeof text === 'string' && text.trim())
    return { seat: seat as Position, userId: user_id, text: text.trim() };
  return null;
}

/** About three seconds at the seat; typed words stay longer, by length. */
export function landingMs(said: Pick<Said, 'text'>): number {
  return said.text ? Math.min(8_000, 3_000 + said.text.length * 60) : 3_000;
}

/** What a seat shows: a newer thing replaces it, the same coin again counts up (×2). */
export interface Landed extends Said {
  count: number;
  /** Changes with every landing, so the card lands again. */
  key: number;
}

export function land(previous: Landed | undefined, said: Said, key: number): Landed {
  const again = !!previous && isCoin(said.item) && previous.item === said.item;
  return { ...said, count: again ? previous.count + 1 : 1, key };
}

/** Talk is for tables with people at them: two or more human seats, as the server counts. */
export function talkTable(
  seats: Record<string, { occupant_type: string }> | null | undefined
): boolean {
  return Object.values(seats ?? {}).filter((seat) => seat.occupant_type === 'human').length >= 2;
}
