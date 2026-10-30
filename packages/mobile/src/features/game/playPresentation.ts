import type { RelativePosition } from '@/types/game';
import type { TableCard, TableModel } from '@/game/canvas/tableModel';
import { PLAY_CONFIRM_TIMEOUT_MS } from '@/game/canvas/animationTiming';

export type PendingPlay = { card: TableCard; startedAt: number; rejected: boolean };

/** Only the picture moves early. Confirmation, including a late one, always wins. */
export function optimisticPlay(model: TableModel, pending: PendingPlay | null, now: number) {
  if (
    !pending ||
    pending.rejected ||
    now >= pending.startedAt + PLAY_CONFIRM_TIMEOUT_MS ||
    model.phase !== 'playing' ||
    !model.yourHand.some((card) => card.key === pending.card.key)
  )
    return model;
  return {
    ...model,
    canPlay: false,
    yourHand: model.yourHand.filter((card) => card.key !== pending.card.key),
    playedCards: {
      ...model.playedCards,
      south: [...(model.playedCards.south ?? []), { ...pending.card, isCurrentTrick: true }],
    },
  };
}

const trickOf = (card: TableCard) => Number(/^trick-(\d+)-/.exec(card.key)?.[1] ?? -1);

/**
 * The trick a landscape phone shows (PID-307): the one being played, or the
 * one just finished until its hold is over (`collectAt`; without a clock,
 * until the next trick starts); never an earlier one. The server keeps every
 * trick of the hand; the table does not.
 */
export function trickOnTable(
  played: TableModel['playedCards'],
  now: number,
  collectAt = Infinity
): TableModel['playedCards'] {
  const cards = Object.values(played).flat();
  const last = Math.max(-1, ...cards.map(trickOf));
  const shows = cards.some((card) => card.isCurrentTrick)
    ? (card: TableCard) => card.isCurrentTrick
    : (card: TableCard) => now < collectAt && trickOf(card) === last;
  return Object.fromEntries(
    Object.entries(played).map(([rel, seat]) => [rel, (seat ?? []).filter(shows)])
  );
}

/** Never infer the next player or the winner; only delay the server's light. */
export function turnLight({
  turn,
  previousTurn,
  now,
  landsAt,
  collectUntil,
  pending,
}: {
  turn: RelativePosition | null;
  previousTurn: RelativePosition | null;
  now: number;
  landsAt: number;
  collectUntil: number;
  pending: boolean;
}): RelativePosition | null {
  if (now < collectUntil) return null;
  if (now < landsAt) return previousTurn;
  return pending ? null : turn;
}
