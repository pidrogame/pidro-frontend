import type { Card, ServerGameState } from '@/types/game';
import type { Position } from '@/types/lobby';

const trickNumber = (state: ServerGameState) =>
  state.current_trick_details?.number ?? (state.tricks?.length ?? 0) + 1;

/** One intent, retained through a lost reply; only the server can accept it. */
export function pendingPlay({
  card,
  position,
  state,
  send,
  reconnect,
}: {
  card: Card;
  position: Position;
  state: ServerGameState;
  send: () => Promise<void>;
  reconnect: () => void;
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
        if (error?.reason === 'disconnected') return;
        if (error?.reason === 'timeout') reconnect();
        else finish(false, error);
      }
    );
  };
  const observe = (next: ServerGameState) => {
    if (settled || next === state) return;
    if (
      next.game_instance_id !== state.game_instance_id ||
      next.hand_number !== state.hand_number
    ) {
      finish(false, { reason: 'not_your_turn' });
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
      finish(false, { reason: 'not_your_turn' });
    }
  };
  return { promise, rejoin, observe, cancel: () => finish(false) };
}
