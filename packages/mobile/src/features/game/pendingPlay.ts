import type { Card, ServerGameState } from '@/types/game';
import type { Position } from '@/types/lobby';

const trickNumber = (state: ServerGameState) =>
  state.current_trick_details?.number ?? (state.tricks?.length ?? 0) + 1;

/** The table moved on before this card reached it: the turn, the trick or the hand. */
const TOO_LATE = { reason: 'too_late' };

/** One intent, retained through a lost reply; only the server can accept it. */
export function pendingPlay({
  card,
  position,
  state,
  send,
}: {
  card: Card;
  position: Position;
  state: ServerGameState;
  send: () => Promise<void>;
}) {
  let settled = false;
  let attempt = 0;
  let resolve!: (accepted: boolean) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<boolean>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const finish = (accepted: boolean, error?: unknown) => {
    if (settled) return;
    settled = true;
    if (error) reject(error);
    else resolve(accepted);
  };
  const rejoin = () => {
    if (settled) return;
    const serial = ++attempt;
    void send().then(
      () => finish(true),
      (error) => {
        if (settled || serial !== attempt) return;
        if (error?.reason === 'disconnected' || error?.reason === 'timeout') return;
        // The client sends only on its turn: the server saying otherwise means the turn moved on.
        finish(false, error?.error_code === 'not_your_turn' ? TOO_LATE : error);
      }
    );
  };
  const observe = (next: ServerGameState) => {
    if (settled || next === state) return;
    if (
      next.game_instance_id !== state.game_instance_id ||
      next.hand_number !== state.hand_number
    ) {
      finish(false, TOO_LATE);
      return;
    }
    const hand = next.players?.[position]?.hand;
    if (
      Array.isArray(hand) &&
      !hand.some((held) => held.rank === card.rank && held.suit === card.suit)
    ) {
      finish(true);
    } else if (
      next.phase !== 'playing' ||
      next.current_player !== position ||
      trickNumber(next) !== trickNumber(state)
    ) {
      finish(false, TOO_LATE);
    }
  };
  return { promise, rejoin, observe, cancel: () => finish(false) };
}
