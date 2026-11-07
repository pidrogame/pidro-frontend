import { useEffect, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import type { RelativePosition } from './layout';
import type { TableModel } from './tableModel';
import {
  DEAL_PACKET_INTERVAL_MS,
  DEAL_SORT_DURATION_MS,
  DEAL_SORT_PAUSE_MS,
  dealtCardCounts,
} from './animationTiming';
import { play } from '../sounds';

/** A presentation only: never delays or mutates authoritative game state. */
export function useDealPresentation(
  model: TableModel,
  dealer: RelativePosition | null
): TableModel {
  const reducedMotion = useReducedMotion();
  const [previous, setPrevious] = useState(model);
  const [deal, setDeal] = useState<{ hand: string; dealer: RelativePosition } | null>(null);
  const [step, setStep] = useState(0);
  const handKey = model.dealtHand.map((card) => card.key).join(',');
  const initialPhase = model.phase === 'dealing' || model.phase === 'bidding';

  if (previous !== model) {
    setPrevious(model);
    if (deal && (!initialPhase || deal.hand !== handKey)) {
      setDeal(null);
    } else if (
      !deal &&
      dealer &&
      initialPhase &&
      model.dealtHand.length === 9 &&
      (previous.yourHand.length === 0 ||
        (previous.phase !== 'bidding' && previous.phase !== 'dealing'))
    ) {
      setDeal({ hand: handKey, dealer });
      setStep(0);
    }
  }

  useEffect(() => {
    if (!deal) return;
    // Schedule from each committed packet, not twelve absolute deadlines:
    // busy frames must not collapse two packets into one six-card arrival.
    const delay =
      step === 0
        ? 0
        : step < 12
          ? DEAL_PACKET_INTERVAL_MS
          : step === 12
            ? DEAL_SORT_PAUSE_MS
            : DEAL_SORT_DURATION_MS;
    // Sound keeps this schedule under Reduce Motion too; only the picture is skipped.
    // A shuffle that began in the hold covers this deal; one that had no room starts here.
    if (step === 0) play('shuffle');
    const timer = setTimeout(() => {
      if (step < 12) play('deal');
      if (step === 13) setDeal(null);
      else setStep(step + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [deal, step]);

  if (!deal || !initialPhase || handKey !== deal.hand) return model;
  if (reducedMotion) return { ...model, dealUnseen: true };
  const counts = dealtCardCounts(deal.dealer, step);
  const seats = { ...model.seats };
  for (const rel of ['north', 'east', 'south', 'west'] as const) {
    const seat = seats[rel];
    if (seat) seats[rel] = { ...seat, cardCount: counts[rel], isCurrentTurn: false };
  }
  return {
    ...model,
    seats,
    yourHand: step === 13 ? model.yourHand : model.dealtHand.slice(0, counts.south),
    canPlay: false,
    // The pack beside the dealer gives what has flown (PID-394).
    pack: 52 - Object.values(counts).reduce((sum, n) => sum + n, 0),
    dealStage: step === 13 ? 'sorting' : 'dealing',
  };
}
