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

export type TableNotice = {
  variant: 'warning' | 'success' | 'error';
  key?: TranslationKey;
  params?: TranslationValues;
  error?: unknown;
  seat?: { name?: string | null; position?: 'north' | 'east' | 'south' | 'west' | null };
  autoTurn?: { scope: 'room' | 'you'; action?: Record<string, unknown> };
  /** Compatibility for development fixtures only. Runtime producers use keys. */
  message?: string;
};
export type QueuedTableNotice = TableNotice & { roomCode: string };

export function tableNoticeText(notice: TableNotice): string {
  if (notice.error !== undefined) {
    const error = errorPayload(notice.error);
    if ((error.error_code ?? error.reason) === 'already_played_for_you')
      return autoTurnText({ scope: 'you', action: error.action as Record<string, unknown> });
    return localizedError(notice.error, notice.key);
  }
  if (notice.autoTurn) return autoTurnText(notice.autoTurn);
  if (notice.seat && notice.key) {
    return t(notice.key, {
      ...notice.params,
      name: notice.seat.name || t('game.notice_player'),
      position: notice.seat.position ? t(`table.position.${notice.seat.position}`) : '',
    });
  }
  return notice.key ? t(notice.key, notice.params) : (notice.message ?? '');
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
