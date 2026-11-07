import type { TranslationKey } from '@pidro/shared';

/**
 * Table talk (PID-114): words are cards, faces are emoji. Only the id travels,
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

export const TALK_EMOJI: Record<TalkCoin, string> = {
  coin_thumb: '👍',
  coin_heart: '❤️',
  coin_ha: '😂',
  coin_oops: '😅',
  coin_wow: '😮',
};

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

/**
 * Talk is for tables with people at them: two or more human seats, as the server counts.
 * During a game only the lifecycle is live; readiness stops updating, and reading it would
 * show the band at a table the server has already closed to talk.
 */
export function talkTable(
  seats: Record<string, { occupant_type: string }> | null | undefined,
  lifecycle?: Record<string, { status: string }> | null
): boolean {
  if (lifecycle)
    return Object.values(lifecycle).filter(({ status }) => HUMAN_SEAT.includes(status)).length >= 2;
  return Object.values(seats ?? {}).filter((seat) => seat.occupant_type === 'human').length >= 2;
}

/** A dropped player's seat stays theirs until a bot takes it. */
const HUMAN_SEAT = ['normal', 'reconnecting'];

/**
 * What the hand of words offers for typing (PID-318). The server says who reads
 * typed talk: an adult account types, a guest is asked to make one, and a 13 to
 * 17 sees nothing about it.
 */
export function typingFor(
  readsTyped: boolean | undefined,
  guest: boolean
): 'type' | 'guest' | null {
  return readsTyped ? 'type' : guest ? 'guest' : null;
}

/** The people seated with you who will not see what you type. */
export function unreadBy(
  seats: Record<string, { occupant_type: string; reads_typed?: boolean }> | null | undefined,
  you: Position
): Position[] {
  return Object.entries(seats ?? {})
    .filter(([seat, { occupant_type, reads_typed }]) => {
      return seat !== you && occupant_type === 'human' && !reads_typed;
    })
    .map(([seat]) => seat as Position);
}

/**
 * The offered word as the upright bubble's tail says it (PID-396), largest
 * first: one line at body size, one at the small label size, two at the small
 * size. Each width is the tail's, its padding included.
 */
export const TAIL_SIZES = ['body', 'small', 'two'] as const;
export type TailSize = (typeof TAIL_SIZES)[number];
/** Under this the tail holds no word worth reading: the bubble lights alone. */
export const TAIL_MIN = 56;

export function tailFit(room: number, widths: Record<TailSize, number>): TailSize | null {
  if (room < TAIL_MIN) return null;
  return TAIL_SIZES.find((size) => widths[size] <= room) ?? null;
}

/** A word in two lines, broken at the space nearest its middle: "Nice / trick!". */
export function twoLines(text: string): string {
  const spaces = [...text.matchAll(/ /g)].map((match) => match.index);
  if (!spaces.length) return text;
  const at = spaces.reduce((best, i) =>
    Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2) ? i : best
  );
  return `${text.slice(0, at)}\n${text.slice(at + 1)}`;
}

/** The most a typed line holds. */
export const SAY_MAX = 80;
