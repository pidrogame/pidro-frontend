/**
 * A settled hand laid down (PID-366): the holder's remaining trumps turn face
 * up in a fan in front of their seat, one card sound each, hold to be read,
 * then gather to their pile in one motion; only then the hand's result. The
 * table shows the hand as it stood when it settled until the gather ends, so
 * the result, the scores and "Takes the rest" wait with it, and the next
 * hand, which the server sends with it, waits too: the server holds its deal
 * 2.5 s longer. A presentation of what the server said (`last_hand.settled`),
 * never game logic.
 */
import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import type { ServerGameState } from '@/types/game';
import { layDown, type LayDown } from '@/features/game/layDown';
import { isStillCapture } from '@/utils/stillCapture';
import type { RelativePosition } from './layout';
import type { TableModel } from './tableModel';
import { LAY_DOWN_GATHER_MS, LAY_DOWN_HOLD_MS, layDownAt, layDownLandsMs } from './animationTiming';
import { play } from '../sounds';

/** The fan as the table draws it: `done` once gathered, while the result holds the hand. */
export type LayDownShow = LayDown & { rel: RelativePosition; step: 'fan' | 'gather' | 'done' };

export function useLayDownPresentation(
  state: ServerGameState | null,
  seats: TableModel['seats']
): { show: LayDownShow | null; before: ServerGameState | null } {
  const reducedMotion = useReducedMotion();
  const [previous, setPrevious] = useState(state);
  const [laid, setLaid] = useState<{ down: LayDown; before: ServerGameState } | null>(null);
  const [step, setStep] = useState<LayDownShow['step']>('fan');
  // A hand settles in one revision from play to the next hand: the decision needs the state before.
  const arriving = state !== previous && previous ? layDown(previous, state) : null;
  if (state !== previous) {
    setPrevious(state);
    if (arriving && previous) {
      setLaid({ down: arriving, before: previous });
      setStep('fan');
    } else if (laid && state?.last_hand?.hand_number !== laid.down.hand) setLaid(null);
  }

  useEffect(() => {
    if (!laid || step === 'done' || isStillCapture()) return;
    // Reduce Motion: the gather is a cut; the holds stay.
    const ms =
      step === 'fan'
        ? layDownLandsMs(laid.down.cards.length) + LAY_DOWN_HOLD_MS
        : reducedMotion
          ? 0
          : LAY_DOWN_GATHER_MS;
    const timer = setTimeout(() => setStep(step === 'fan' ? 'gather' : 'done'), ms);
    return () => clearTimeout(timer);
  }, [laid, step, reducedMotion]);

  // A card sounds as it leaves the hand, under Reduce Motion too.
  useEffect(() => {
    if (!laid) return;
    const n = laid.down.cards.length;
    const timers = laid.down.cards.map((_, i) => setTimeout(() => play('card'), layDownAt(i, n)));
    return () => timers.forEach(clearTimeout);
  }, [laid]);

  const relOf = (down: LayDown | undefined) =>
    down &&
    Object.values(seats).find((seat) => seat?.absolutePosition === down.position)?.relativePosition;
  const rel = relOf(laid?.down);
  // One object per step: the table's presentations compare models by identity.
  const show = useMemo(() => (laid && rel ? { ...laid.down, rel, step } : null), [laid, rel, step]);
  // The render the settled state arrives on already holds it, so nothing shows it before the fan.
  const arrivingAt = relOf(arriving ?? undefined);
  if (arriving && arrivingAt && previous)
    return { show: { ...arriving, rel: arrivingAt, step: 'fan' }, before: previous };
  return { show, before: show && step !== 'done' ? (laid?.before ?? null) : null };
}

/** The holder's cards are on the felt, not in their hand, and nobody is on turn. */
export function laidDown(model: TableModel, show: LayDownShow | null): TableModel {
  if (!show) return model;
  const seats = Object.fromEntries(
    Object.entries(model.seats).map(([rel, seat]) => [
      rel,
      seat && {
        ...seat,
        isCurrentTurn: false,
        cardCount: rel === show.rel ? 0 : seat.cardCount,
      },
    ])
  ) as TableModel['seats'];
  return {
    ...model,
    seats,
    yourHand: show.rel === 'south' ? [] : model.yourHand,
    canPlay: false,
    currentTurnRelative: null,
    layDown: show,
  };
}
