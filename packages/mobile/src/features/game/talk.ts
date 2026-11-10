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

/**
 * A bot's lines (PID-408): `line_<voice>_<moment>_<n>`, numbered from 1, as many
 * as the contract with the server lists for each moment. Coins in a voice's pool
 * are plain coins.
 */
const VOICES = ['cheerful', 'warm', 'dry', 'teasing'] as const;
const MOMENT_LINES = {
  hello: 5,
  bold_bid: 5,
  partner_points: 5,
  five_caught: 5,
  five_lost: 5,
  we_made: 5,
  we_set: 5,
  they_set: 5,
  game_won: 5,
  game_lost: 5,
  reply_hello: 3,
  reply_thanks: 3,
  reply_sorry: 3,
  reply_game: 3,
};
export type TalkLine = `line_${(typeof VOICES)[number]}_${keyof typeof MOMENT_LINES}_${number}`;
export const TALK_LINES = VOICES.flatMap((voice) =>
  Object.entries(MOMENT_LINES).flatMap(([moment, count]) =>
    Array.from({ length: count }, (_, i) => `line_${voice}_${moment}_${i + 1}` as TalkLine)
  )
);
const ITEMS: readonly string[] = [...TALK_WORDS, ...TALK_COINS, 'word_noworries', ...TALK_LINES];

export type TalkCoin = (typeof TALK_COINS)[number];
export type TalkItem = (typeof TALK_WORDS)[number] | TalkCoin | 'word_noworries' | TalkLine;
export type Position = 'north' | 'east' | 'south' | 'west';

/** One thing said at the table: a word or a face, or (PID-318) typed text. */
export interface Said {
  /** The room's number for the line (PID-418): a line heard twice shows once. */
  id?: number;
  seat: Position;
  /** A person's account, or `bot:<persona>` for a bot (PID-408). */
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
  const { id, seat, user_id, item, text } = payload as Record<string, unknown>;
  if (typeof seat !== 'string' || !POSITIONS.includes(seat) || typeof user_id !== 'string')
    return null;
  const line = {
    ...(Number.isInteger(id) && { id: id as number }),
    seat: seat as Position,
    userId: user_id,
  };
  if (typeof item === 'string' && ITEMS.includes(item)) return { ...line, item: item as TalkItem };
  if (typeof text === 'string' && text.trim()) return { ...line, text: text.trim() };
  return null;
}

const same = (a: Said, b: Said) =>
  a.seat === b.seat && a.userId === b.userId && a.item === b.item && a.text === b.text;

/** Whether this line is already held: by its id, which every line from a current server carries. */
export const heard = (held: Said[], said: Said) =>
  said.id !== undefined && held.some((line) => line.id === said.id);

/**
 * The room's talk after a join reply's replay (PID-418), oldest first. A line with an
 * id joins unless that id is held. A server without ids: what this device holds ends
 * where it overlaps the replay, or sits inside it whole, and the longest overlap wins.
 * With no overlap, a `whole` replay (the room's every line) is the truth: what this
 * device holds and the server no longer shows it, someone blocked since, goes.
 */
export function mergeTalk(held: Said[], replay: Said[], whole = false): Said[] {
  if (replay.length && replay.every((said) => said.id !== undefined)) {
    const all = [...held, ...replay.filter((said) => !heard(held, said))];
    // A line heard live while joining comes before the reply's older ones: the ids order them.
    return all.every((said) => said.id !== undefined) ? all.sort((a, b) => a.id! - b.id!) : all;
  }
  for (let k = Math.min(held.length, replay.length); k > 0; k--) {
    const tail = held.slice(-k);
    const starts = k === held.length ? replay.length - k : 0;
    for (let at = 0; at <= starts; at++)
      if (tail.every((said, i) => same(said, replay[at + i])))
        return [...held, ...replay.slice(at + k)];
  }
  return whole ? replay : [...held, ...replay];
}

/** A line of nothing but emoji, drawn larger (PID-418). */
export function onlyEmoji(text: string | undefined): boolean {
  const bare = text?.replace(/\s/g, '');
  return (
    !!bare &&
    /^(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2})+$/u.test(
      bare
    )
  );
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

/** Who a seat's words come from, so Quiet hushes them: a bot by persona, a person by account. */
export const talker = (seat: { bot_persona?: string | null; playerId: string | null }) =>
  seat.bot_persona ? `bot:${seat.bot_persona}` : seat.playerId;

/**
 * Talk is for a person with company (PID-408): `people` where two or more humans sit,
 * as the server counts, `bots` where the rest of the company is bots. Typing needs people.
 * During a game only the lifecycle is live; readiness stops updating, and reading it would
 * show the band at a table the server has already closed to talk.
 */
export function talkTable(
  seats: Record<string, { occupant_type: string }> | null | undefined,
  lifecycle?: Record<string, { status: string }> | null
): 'people' | 'bots' | null {
  const kinds = lifecycle
    ? Object.values(lifecycle).map(({ status }) =>
        HUMAN_SEAT.includes(status) ? 'human' : status === 'vacant' ? 'vacant' : 'bot'
      )
    : Object.values(seats ?? {}).map((seat) => seat.occupant_type);
  const humans = kinds.filter((kind) => kind === 'human').length;
  if (humans >= 2) return 'people';
  return humans === 1 && kinds.includes('bot') ? 'bots' : null;
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

/** A name in the waiting room's lines (PID-420): a very long one ends in "…" so the words lead. */
export function talkName(name: string, most = 16): string {
  const letters = [...name];
  return letters.length > most ? `${letters.slice(0, most - 1).join('')}…` : name;
}

/** The most a typed line holds. */
export const SAY_MAX = 80;

/**
 * Why a `say` or a `talk` did not go (PID-420), as the line under it says: the
 * channel's refusals by name (game_channel.ex), and a timeout, a lost socket or
 * anything else as "didn't go through".
 */
export function talkRefusal(error: unknown): TranslationKey {
  const code = (error as { error?: unknown } | null)?.error;
  return typeof code === 'string' && Object.hasOwn(REFUSALS, code)
    ? REFUSALS[code]
    : 'talk.report_failed';
}

const REFUSALS: Record<string, TranslationKey> = {
  filtered: 'talk.filtered',
  rate_limited: 'talk.slow_down',
  no_table: 'talk.closed',
  not_seated: 'talk.not_seated',
  not_allowed: 'talk.faces_only',
  invalid_text: 'talk.invalid_text',
};
