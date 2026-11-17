import {
  t,
  localizedError,
  errorPayload,
  type TranslationKey,
  type TranslationValues,
  SUIT_SYMBOLS,
  getRankLabel,
  type Suit,
} from '@pidro/shared';
import type { Card } from '@/types/game';
import { readingTimeMs } from '@/features/game/readingTime';

export type TableNotice = {
  variant: 'warning' | 'success' | 'error';
  key?: TranslationKey;
  params?: TranslationValues;
  error?: unknown;
  seat?: { name?: string | null; position?: 'north' | 'east' | 'south' | 'west' | null };
  autoTurn?: { scope: 'room' | 'you'; action?: Record<string, unknown> };
  /** Cards played for you while you were away, and whether that left you out of the hand. */
  away?: { cards: Card[]; out: boolean };
  /** Compatibility for development fixtures only. Runtime producers use keys. */
  message?: string;
};
export type QueuedTableNotice = TableNotice & { roomCode: string };

/** However short its words, a notice stays this long. */
const NOTICE_MIN_MS = 6000;
/** Something the table did for you, played or passed while you could not, stays longer. */
const DONE_FOR_YOU_MIN_MS = 8000;

/**
 * How long the first notice of a room's queue stays unless tapped: its full
 * reading time however many wait behind it. The queue keeps at most two
 * waiting (enqueueTableNotice), so the newest is never more than two reads late.
 */
export function noticeHoldMs([notice]: readonly TableNotice[]): number {
  const code = errorPayload(notice.error);
  const doneForYou =
    notice.autoTurn?.scope === 'you' ||
    notice.away !== undefined ||
    (notice.error !== undefined && (code.error_code ?? code.reason) === 'already_played_for_you');
  return Math.max(
    readingTimeMs(tableNoticeText(notice)),
    doneForYou ? DONE_FOR_YOU_MIN_MS : NOTICE_MIN_MS
  );
}

/** What the band says about an action the server did not take. */
export function refusalNotice(error: unknown): TableNotice {
  const body = errorPayload(error);
  const code = body.error_code ?? body.reason;
  if (code === 'too_late') return { key: 'game.too_late', variant: 'warning' };
  return {
    error,
    key: 'error.action_failed',
    variant: code === 'already_played_for_you' ? 'warning' : 'error',
  };
}

export function tableNoticeText(notice: TableNotice): string {
  if (notice.error !== undefined) {
    const error = errorPayload(notice.error);
    if ((error.error_code ?? error.reason) === 'already_played_for_you')
      return autoTurnText({ scope: 'you', action: error.action as Record<string, unknown> });
    return localizedError(notice.error, notice.key);
  }
  if (notice.autoTurn) return autoTurnText(notice.autoTurn);
  if (notice.away) return awayText(notice.away);
  if (notice.seat && notice.key) {
    return t(notice.key, {
      ...notice.params,
      name: notice.seat.name || t('game.notice_player'),
      position: notice.seat.position ? t(`table.position.${notice.seat.position}`) : '',
    });
  }
  return notice.key ? t(notice.key, notice.params) : (notice.message ?? '');
}

function awayText({ cards, out }: NonNullable<TableNotice['away']>): string {
  const labels = cards.map((card) => `${getRankLabel(card.rank)}${SUIT_SYMBOLS[card.suit]}`);
  const last = labels[labels.length - 1];
  const list =
    labels.length === 1
      ? last
      : labels.length === 2
        ? t('game.list_two', { first: labels[0], last })
        : t('game.list_more', { first: labels[0], rest: labels.slice(1, -1).join(', '), last });
  return t(out ? 'game.away_played_out' : 'game.away_played', {
    count: cards.length,
    cards: list,
  });
}

function autoTurnText({ scope, action }: NonNullable<TableNotice['autoTurn']>): string {
  const types = [
    'pass',
    'bid',
    'declare_trump',
    'play_card',
    'select_hand',
    'select_dealer',
  ] as const;
  let type: (typeof types)[number] | 'acted' = 'acted';
  for (const candidate of types) if (action?.type === candidate) type = candidate;
  const suitName = (suit: unknown) => {
    switch (suit) {
      case 'hearts':
        return t('game.hearts');
      case 'diamonds':
        return t('game.diamonds');
      case 'clubs':
        return t('game.clubs');
      case 'spades':
        return t('game.spades');
      default:
        return null;
    }
  };
  const card = action?.card as { rank?: unknown; suit?: unknown } | undefined;
  const rank =
    typeof card?.rank === 'number' &&
    Number.isInteger(card.rank) &&
    card.rank >= 2 &&
    card.rank <= 14
      ? card.rank >= 11
        ? t(`game.rank.${card.rank}` as TranslationKey)
        : String(card.rank)
      : null;
  const suit = suitName(action?.suit);
  const cardSuit = suitName(card?.suit);
  const position = action?.position;
  const dealer =
    position === 'north' || position === 'east' || position === 'south' || position === 'west'
      ? t(`table.position.${position}`)
      : null;
  const detail =
    type === 'play_card' && rank && cardSuit
      ? 'card'
      : type === 'declare_trump' && suit
        ? 'trump'
        : type === 'select_dealer' && dealer
          ? 'dealer'
          : type;
  return t(`game.auto_${scope}_${detail}`, {
    amount: typeof action?.amount === 'number' ? action.amount : '',
    suit: suit ?? '',
    card:
      rank && cardSuit
        ? `${getRankLabel(card!.rank as number)}${SUIT_SYMBOLS[card!.suit as Suit]}`
        : '',
    position: dealer ?? '',
  });
}

function identity(notice: TableNotice): string {
  const body = errorPayload(notice.error);
  const params = Object.entries(notice.params ?? {}).sort(([a], [b]) => a.localeCompare(b));
  // Never serialize an Axios request/response graph (it can contain cycles).
  return JSON.stringify([
    notice.key,
    params,
    body.error_code ?? body.code,
    notice.message,
    notice.variant,
    notice.seat?.name,
    notice.seat?.position,
    notice.autoTurn?.scope,
    notice.autoTurn &&
      Object.entries(notice.autoTurn.action ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    notice.away,
  ]);
}

export function enqueueTableNotice(
  current: QueuedTableNotice[],
  notice: TableNotice,
  roomCode: string
): QueuedTableNotice[] {
  const roomNotices = current.filter((entry) => entry.roomCode === roomCode);
  const tail = roomNotices[roomNotices.length - 1];
  if (tail && identity(tail) === identity(notice) && tail.error === notice.error)
    return roomNotices;

  const next = [...roomNotices, { ...notice, roomCode }];
  return next.length <= 3 ? next : [next[0], ...next.slice(-2)];
}
