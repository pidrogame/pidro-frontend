import type { RelativePosition } from '@/types/game';
import type { TableCard, TableModel } from '@/game/canvas/tableModel';

export type PendingPlay = { card: TableCard; startedAt: number; rejected: boolean };

/** Only the picture moves early. Confirmation, including a late one, always wins. */
export function optimisticPlay(model: TableModel, pending: PendingPlay | null, _now: number) {
  if (
    !pending ||
    pending.rejected ||
    model.phase !== 'playing' ||
    model.currentTurnRelative !== 'south' ||
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

/**
 * What a tap the table did not play does (PID-364): its card shakes and the
 * seat on turn lights up (`nudge`). A tap while your own card is on its way,
 * or while the table is still dealing or settling, does `nothing`. While
 * another seat is on turn, the first tap also says whose turn it is (`name`),
 * and every later tap while the same seat is on turn does nothing (PID-485):
 * a shake for each of a waiting player's taps read as lag, not as "wait".
 */
export function blockedTapAnswer(
  reason: string,
  {
    inFlight,
    dealing,
    turn,
    answered,
  }: {
    inFlight: boolean;
    dealing: boolean;
    turn: RelativePosition | null;
    /** The seat on turn the last `name` answered in this wait. */
    answered: RelativePosition | null;
  }
): 'nothing' | 'nudge' | 'name' {
  if (reason === 'pending' || inFlight || dealing) return 'nothing';
  if (reason !== 'not_your_turn' || turn === 'south') return 'nudge';
  // No seat lit while the server has the turn elsewhere: the trick is still settling.
  if (!turn) return 'nothing';
  return turn === answered ? 'nothing' : 'name';
}
