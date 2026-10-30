/**
 * The second deal, played out on the table at Classic's pace so the counts
 * can be read off the cards: each player in turn throws their non-trumps
 * face down in front of them, the piles hold to be counted and clear, the
 * dealer gives each player their cards one at a time, takes the rest and
 * throws down to six last. Throws are backs; only the dealer sees their own (`showAt`).
 * Then any killed trumps lie face up for everyone, KILLED_SHOW_MS or until
 * the first card lands, without holding play (PID-306). Built only from the
 * server's counts and the hands it already sent: a presentation, never game
 * logic. The server holds play for the second deal
 * (second_deal_transition_delay_ms).
 */
import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import type { Card, DealerRobPresentation } from '@/types/game';
import type { TableCard, TableModel } from './tableModel';
import {
  AFTER,
  BEFORE,
  CLOCKWISE,
  dealerThrow,
  makePlan,
  showAt,
  type Plan,
  type SecondDealShow,
} from './secondDealPlan';
import { KILLED_SHOW_MS } from './animationTiming';

export type { SecondDealShow } from './secondDealPlan';

const hasPlay = (model: TableModel) =>
  Object.values(model.currentTrick).some(Boolean) || model.lastTrick != null;

const cardKey = (c: Card) => `${c.suit}_${c.rank}`;

/** `rob`: your own pick from the pack when you deal (private to you), else null. */
export function useSecondDealPresentation(
  model: TableModel,
  rob: DealerRobPresentation | null = null
): TableModel {
  const reducedMotion = useReducedMotion();
  // What this hook reacts to. The model is a new object on every render
  // while the first deal plays, so it is compared by what it says, not by
  // identity, or each render would set state and render again.
  const signature = [
    model.phase,
    model.yourHand.map((card) => card.key).join(','),
    CLOCKWISE.map((rel) => {
      const seat = model.seats[rel];
      return `${seat?.cardCount}/${seat?.secondDeal?.kept}/${seat?.secondDeal?.drawn}`;
    }).join(' '),
    hasPlay(model),
  ].join('|');
  const [previous, setPrevious] = useState(signature);
  // Your nine, remembered until the discard so the cards you kept can stay put.
  const [held, setHeld] = useState<TableCard[] | null>(null);
  const [armed, setArmed] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [step, setStep] = useState(0);
  // Dealing yourself: the pool you were shown less the six you kept, held
  // past the server's few seconds of showing your pick.
  const robbed = dealerThrow(rob?.pool, rob?.kept);
  const [dealt, setDealt] = useState<Card[] | null>(null);
  if (robbed?.length && robbed.map(cardKey).join() !== dealt?.map(cardKey).join()) setDealt(robbed);
  // The killed trumps that have had their moment.
  const killedKey = JSON.stringify(model.killed ?? {});
  const [killedShown, setKilledShown] = useState<string | null>(null);

  if (previous !== signature) {
    setPrevious(signature);
    if (BEFORE.has(model.phase)) {
      if (plan) setPlan(null);
      if (!armed) setArmed(true);
      if (dealt) setDealt(null);
      if (killedShown) setKilledShown(null);
      if (model.yourHand.length > 0) setHeld(model.yourHand);
    } else if (!AFTER.has(model.phase)) {
      if (plan) setPlan(null);
      if (armed) setArmed(false);
    } else if (plan && hasPlay(model)) {
      setPlan(null);
    } else if (armed && !plan && !reducedMotion) {
      const next = makePlan(model, held);
      if (next) {
        setPlan(next);
        setStep(0);
        setArmed(false);
      }
    }
  }

  const frame = plan ? plan.frames[Math.min(step, plan.frames.length - 1)] : null;
  const atEnd = !!plan && step >= plan.frames.length - 1;

  // Another dealer's pile waits for them to be down to six. Your own pick
  // has its panel, which the table must not hold back.
  const dealerPicking =
    !!frame?.dealerThrew &&
    model.phase === 'second_deal' &&
    model.dealerRelative !== 'south' &&
    model.seats[model.dealerRelative ?? 'south']?.discarded == null;
  useEffect(() => {
    if (!plan || !frame || dealerPicking) return;
    const timer = setTimeout(() => (atEnd ? setPlan(null) : setStep(step + 1)), frame.ms);
    return () => clearTimeout(timer);
  }, [plan, frame, atEnd, step, dealerPicking]);

  // Once the second deal has played, killed trumps show until the first card lands.
  const anyKilled = killedKey !== '{}';
  const showKilled =
    anyKilled && !plan && model.phase === 'playing' && !hasPlay(model) && killedShown !== killedKey;
  useEffect(() => {
    if (!showKilled) return;
    const timer = setTimeout(() => setKilledShown(killedKey), KILLED_SHOW_MS);
    return () => clearTimeout(timer);
  }, [showKilled, killedKey]);
  const shown = useMemo(
    () => (anyKilled && !showKilled ? { ...model, killed: {} } : model),
    [model, anyKilled, showKilled]
  );

  if (!plan || !frame || reducedMotion || !AFTER.has(model.phase) || hasPlay(model)) return shown;

  const dealer = model.dealerRelative;
  const show: SecondDealShow = showAt(frame, model, dealt);
  const seats = { ...model.seats };
  for (const rel of CLOCKWISE) {
    const seat = seats[rel];
    if (!seat) continue;
    // Thrown down to six, the dealer holds what the server says.
    const count =
      frame.dealerThrew && rel === dealer && seat.discarded != null
        ? seat.cardCount
        : frame.hand[rel];
    seats[rel] = { ...seat, cardCount: count ?? seat.cardCount, isCurrentTurn: false };
  }
  // Your hand follows the same beats: what you throw leaves in your turn to
  // throw, what you are given arrives one card at a time. Dealing yourself,
  // you hold your nine until you take the pack and throw.
  let yourHand = model.yourHand;
  if (dealer === 'south') {
    const gone = new Set((dealt ?? []).map(cardKey));
    if (held && !atEnd && !frame.dealerThrew) yourHand = held;
    // Your pick may still be in hand as the whole pool: what you threw lies in front of you.
    else yourHand = model.yourHand.filter((card) => !gone.has(cardKey(card.card)));
  } else if (plan.yourThrown && plan.yourDrawn) {
    const gone = new Set(
      plan.yourThrown.slice(0, frame.out.south ?? 0).map((card) => card.textureKey)
    );
    const stillHeld = (held ?? []).filter((card) => !gone.has(card.textureKey));
    const keptKeys = new Set(stillHeld.map((card) => card.textureKey));
    const arrived = new Set(
      plan.yourDrawn.slice(0, frame.drawn.south ?? 0).map((card) => card.textureKey)
    );
    yourHand = [
      ...stillHeld.filter((card) => !model.yourHand.some((c) => c.textureKey === card.textureKey)),
      ...model.yourHand.filter(
        (card) => keptKeys.has(card.textureKey) || arrived.has(card.textureKey)
      ),
    ];
  }
  return {
    ...model,
    seats,
    yourHand,
    canPlay: false,
    dealStage: 'dealing',
    secondDealShow: show,
    killed: {},
  };
}
