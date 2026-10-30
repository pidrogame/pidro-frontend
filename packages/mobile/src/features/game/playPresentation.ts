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
