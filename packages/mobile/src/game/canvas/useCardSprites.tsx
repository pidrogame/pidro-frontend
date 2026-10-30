/**
 * M2 interaction + M3 animation engine for the Skia table.
 *
 * A fixed pool of card "sprites" (stable Reanimated shared values) is reconciled
 * against the render model every change: each visible card (your hand + every
 * trick card) is assigned a slot and animated toward its target position. Hand
 * and server trick keys differ; matching card textures transfer the existing
 * slot, including an optimistic flight, without fading or restarting it.
 *
 * Gestures (canvas-level Pan+Tap, hit-tested against legal hand cards) call
 * onPlayCard. Model diffs include the local pending-play presentation, with
 * the cold-load rule: the first model snaps into place, only
 * later diffs animate. M3 adds, all diff-triggered:
 *   • deal-in   — hand grows from empty → stagger from a deck origin w/ overshoot
 *   • history   — completed tricks keep stable slots for the server's round history
 *   • trump     — null→suit pops the trump glyph (exposed via `trumpPop`)
 *   • reflow    — layout change tweens sprites to new slots (falls out of the effect)
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { Group, Image, RoundedRect, type SkImage } from '@shopify/react-native-skia';
import {
  Easing,
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { Card, Suit } from '@/types/game';
import { trumpsIn } from '@/features/game/trump';
import { catchUpPace } from '@/features/game/catchUp';
import { isStillCapture } from '@/utils/stillCapture';
import { playSelectionHaptic } from '@/utils/haptics';
import { blockedCardTap, blockedPlay, cardTap } from '@/diagnostics/actions';
import type { DiagnosticCode } from '@/diagnostics/buffer';
import {
  handLift,
  handScale as handScaleFor,
  handStep,
  playedCardTarget,
  trailSpot,
  type RelativePosition,
  type TableLayout,
  heldPose,
  HELD_STYLE,
  packSpot,
} from './layout';
import type { TableCard, TableModel } from './tableModel';
import type { CardKey, CardTextures } from './cardTextures';
import { cardKey } from './cardKey';
import {
  CUT_CARD_STAGGER_MS,
  CUT_CARD_TRAVEL_MS,
  CUT_WINNER_PAUSE_MS,
  DEAL_CARD_STAGGER_MS,
  DEAL_CARD_TRAVEL_MS,
  DEAL_PACKET_CARD_STAGGER_MS,
  DEAL_PACKET_TRAVEL_MS,
  DEAL_SORT_DURATION_MS,
  PLAY_CARD_TRAVEL_MS,
  PLAY_CARD_CURVE,
  PLAY_CARD_LIFT,
  OPPONENT_CARD_LIFT,
  PLAY_CARD_LIFT_MS,
  PLAY_CARD_LIFT_CURVE,
  PLAY_CARD_SCALE,
  OPPONENT_CARD_SCALE,
  HAND_CLOSE_SPRING,
  TRICK_SWEEP_ENABLED,
  TRICK_GATHER_MS,
  TRICK_SWEEP_MS,
  TRICK_GATHER_PROGRESS,
  TRICK_GATHER_CURVE,
  TRICK_SWEEP_CURVE,
  TRICK_SWEEP_SCALE,
} from './animationTiming';
import { T } from './tokens';
import { keptBlur, useKeptBlurs, type BakedBlur } from './bakedBlur';

function motionEasing(curve: readonly [number, number, number, number]) {
  return {
    factory: () => {
      'worklet';
      const bezier = Easing.bezier(...curve).factory();
      return (time: number) => {
        'worklet';
        // Web's first rAF can predate the effect that starts the animation.
        return bezier(Math.max(0, Math.min(1, time)));
      };
    },
  };
}

const MAX = 36;
/** A played card's glow waits for the card to land. */
const LEAD_GLOW_DELAY_MS = PLAY_CARD_TRAVEL_MS;
/** A trick total jumping by this much means a five landed. */
const FIVE_POINTS = 5;
/** Press feedback on a hand card: lift on touch, play on release. */
const PRESS_LIFT = 0.1;
const PRESS_LIFT_MS = 90;
const PRESS_SETTLE_MS = 160;
/** A finger may wander this far and still be a tap; further cancels it. */
const PRESS_SLOP = 20;
/** Long enough for a slow, careful press. */
const PRESS_MAX_MS = 10_000;
/** A tapped card that has not flown by then was not played; drop it back. */
const PRESS_UNPLAYED_MS = 700;
/** A, J, 10, 5 and 2: the cards that score in Pidro. */
const POINT_RANKS = new Set([14, 11, 10, 5, 2]);
const REL: RelativePosition[] = ['north', 'east', 'south', 'west'];
/** The cut's winner stays lit this long before the server deals. */
const CUT_WINNER_READ_MS = 700;
/** When the cut's winner lights up, at the cut's own pace. */
const cutRevealAt = (cuts: number) =>
  Math.max(0, cuts - 1) * CUT_CARD_STAGGER_MS + CUT_CARD_TRAVEL_MS + CUT_WINNER_PAUSE_MS;

function handSlotFn(L: TableLayout, n: number) {
  const step = handStep(L, n);
  return (i: number) => {
    const off = i - (n - 1) / 2;
    // Straight row — no arc dip, no fan rotation (user preference).
    return { x: L.hand.cx + off * step, y: L.hand.cy, rot: 0 };
  };
}

type HandTarget = {
  slot: number;
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
};
type SlotInfo = {
  key: string;
  textureKey: CardKey;
  kind: 'hand' | 'cut' | 'played';
  z: number;
  legal: boolean;
  blocked: boolean;
  winner: boolean;
  /** The played card taking the trick, as the server says. */
  leading: boolean;
  /** A five that just landed: it shimmers once. */
  flashing: boolean;
  /** Would be trump under the suit being considered. */
  previewed: boolean;
  lift: number;
  collectTo?: { x: number; y: number };
} | null;

type Opts = {
  model?: TableModel;
  textures?: CardTextures;
  L: TableLayout;
  onPlayCard?: (card: Card) => void;
  enabled: boolean;
  /** Picking trump: the suit under the finger, whose trumps lift in the hand. */
  previewSuit?: Suit | null;
};

export function useCardSprites({
  model,
  textures,
  L,
  onPlayCard,
  enabled,
  previewSuit = null,
}: Opts) {
  /* eslint-disable react-hooks/rules-of-hooks -- fixed-length pools → stable hook order */
  const sx = Array.from({ length: MAX }, () => useSharedValue(0));
  const sy = Array.from({ length: MAX }, () => useSharedValue(0));
  const sscale = Array.from({ length: MAX }, () => useSharedValue(1));
  const srot = Array.from({ length: MAX }, () => useSharedValue(0));
  const sop = Array.from({ length: MAX }, () => useSharedValue(0));
  const flight = Array.from({ length: MAX }, () => useSharedValue(1));
  const collection = Array.from({ length: MAX }, () => useSharedValue(0));
  /* eslint-enable react-hooks/rules-of-hooks */

  const [slots, setSlots] = useState<SlotInfo[]>(() => Array(MAX).fill(null));
  const reduceMotion = useReducedMotion();

  const keyToSlot = useRef<Map<string, number>>(new Map());
  const targets = useRef<Map<number, string>>(new Map());
  const retirementTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const cutSequenceKey = useRef<string | null>(null);
  const cutSequenceStartedAt = useRef(0);
  // 1 as designed; less when this phone is behind the server; 0 skips to the result.
  const cutPace = useRef(1);
  const winnerRevealSequenceKey = useRef<string | null>(null);
  const prevModel = useRef<TableModel | null>(null);
  const prevLayout = useRef(L);
  const modelRef = useRef<TableModel | undefined>(model);
  const onPlayRef = useRef(onPlayCard);
  modelRef.current = model;
  onPlayRef.current = onPlayCard;

  const handTargets = useSharedValue<HandTarget[]>([]);
  // Observational hit targets only; legal hit testing and press feedback stay unchanged.
  const blockedTargets = useSharedValue<(HandTarget & { code: DiagnosticCode })[]>([]);
  const blockedPress = useSharedValue<DiagnosticCode | null>(null);
  // The hand card under a finger that is still down: lifted, not yet played.
  const pressSlot = useSharedValue(-1);
  const pressKey = useSharedValue('');

  useEffect(
    () => () => {
      retirementTimers.current.forEach(clearTimeout);
      retirementTimers.current.clear();
      flight.forEach(cancelAnimation);
      collection.forEach(cancelAnimation);
    },
    // Fixed shared-value pools live for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── M3 shared values ──────────────────────────────────────────────
  const trumpPop = useSharedValue(0); // 0..1 flourish on trump declare
  const winnerReveal = useSharedValue(0);
  // The trick's winning card glows; each new leader pops the glow in again.
  const leadGlow = useSharedValue(0);
  // A five landing shimmers once: the trick now holds a Pidro.
  const flashGlow = useSharedValue(0);
  const flashKey = useRef<string | null>(null);
  const cardW = L.cardW;
  const cardH = L.cardH;
  const handScale = handScaleFor(L.profile);

  useLayoutEffect(() => {
    if (!enabled || !model) return;
    const prev = prevModel.current;
    const firstLoad = prev === null;
    const n = model.yourHand.length;
    const handSlot = handSlotFn(L, n);

    // ── M3 diff triggers ────────────────────────────────────────────
    const prevHandLen = prev?.yourHand.length ?? 0;
    const packetDeal = model.dealStage === 'dealing';
    const isDeal = packetDeal || (!firstLoad && prevHandLen === 0 && n > 0);
    const isSorting = model.dealStage === 'sorting' && prev?.dealStage !== 'sorting';
    const sameHand =
      prev?.yourHand.length === n &&
      model.yourHand.every((card, i) => card.key === prev.yourHand[i].key);

    // The server's trick total jumping by five means a five just landed. The
    // client never reads card values; it only reads that jump.
    if (
      !firstLoad &&
      model.latestPlayKey &&
      model.trickPoints != null &&
      model.latestPlayKey !== prev?.latestPlayKey &&
      model.trickPoints - (prev?.trickPoints ?? 0) >= FIVE_POINTS
    ) {
      flashKey.current = model.latestPlayKey;
      cancelAnimation(flashGlow);
      flashGlow.value = 0;
      if (!reduceMotion && !isStillCapture()) {
        flashGlow.value = withDelay(
          LEAD_GLOW_DELAY_MS,
          withSequence(
            withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) }),
            withTiming(0.35, { duration: 220 }),
            withTiming(1, { duration: 180 }),
            withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) })
          )
        );
      }
    }

    if (!firstLoad && !prev?.trumpSuit && model.trumpSuit) {
      trumpPop.value = 0;
      trumpPop.value = withSequence(
        withTiming(1, { duration: 170, easing: Easing.out(Easing.back(2)) }),
        withTiming(0, { duration: 460, easing: Easing.in(Easing.quad) })
      );
    }

    // Second-deal cards come from the pack in its corner; the first deal from the middle.
    const pack = model.secondDealShow ? packSpot(L) : null;
    const deckX = pack?.x ?? L.felt.cx;
    const deckY = pack?.y ?? L.trick.cy;

    type Desired = {
      key: string;
      textureKey: CardKey;
      kind: 'hand' | 'cut' | 'played';
      z: number;
      delayOrder: number;
      tx: number;
      ty: number;
      trot: number;
      tscale: number;
      ox: number;
      oy: number;
      legal: boolean;
      blocked: boolean;
      previewed: boolean;
      topacity: number;
      ownPlay?: boolean;
      completed?: boolean;
    };
    const desired: Desired[] = [];
    const preview = new Set<string>(
      previewSuit
        ? trumpsIn(
            model.yourHand.map((tc) => tc.card),
            previewSuit
          ).map(cardKey)
        : []
    );

    const played = model.playedCards;
    const trickNo = (tc: TableCard) => Number(/^trick-(\d+)-/.exec(tc.key)?.[1] ?? -1);
    const all = REL.flatMap((rel) => played[rel] ?? []);
    const liveTrick = all.some((tc) => tc.isCurrentTrick)
      ? Math.max(...all.filter((tc) => tc.isCurrentTrick).map(trickNo))
      : Math.max(-1, ...all.map(trickNo));
    // A card of yours lifts only into your empty spot, never onto your card
    // still lying there from the trick just taken (PID-307).
    const spotTaken = !!L.front && (played.south ?? []).some((tc) => trickNo(tc) === liveTrick);

    model.yourHand.forEach((tc, i) => {
      const s = handSlot(i);
      const legal = model.canPlay && tc.isLegalPlay;
      const blocked = model.canPlay && !tc.isLegalPlay;
      const previewed = preview.has(tc.textureKey);
      // Reduce Motion keeps a previewed card in the row: its outline says enough.
      const lifted = (legal || (previewed && !reduceMotion)) && !spotTaken;
      // Held by a hand, not printed: each card keeps a slight tilt of its own.
      const held = heldPose(model.held ?? HELD_STYLE, tc.key, i - (n - 1) / 2);
      desired.push({
        key: tc.key,
        textureKey: tc.textureKey,
        kind: 'hand',
        z: i + (lifted ? 30 : 0),
        delayOrder: i,
        tx: s.x,
        ty: (lifted ? s.y - handLift(L) : s.y) + held.dy,
        trot: s.rot + (held.tilt * Math.PI) / 180,
        tscale: handScale * (legal ? 1.03 : blocked ? 0.98 : 1),
        ox: s.x,
        oy: s.y,
        legal,
        blocked,
        previewed,
        topacity: 1,
      });
    });
    REL.forEach((rel, cutIndex) => {
      const tc = model.dealerCuts[rel];
      if (!tc) return;
      const target = playedCardTarget(L, rel, 0, 1);
      const seat = L.seats[rel];
      desired.push({
        key: tc.key,
        textureKey: tc.textureKey,
        kind: 'cut',
        z: 90,
        delayOrder: cutIndex,
        tx: target.x,
        ty: target.y,
        trot: target.rot,
        tscale: target.scale,
        ox: seat.x,
        oy: seat.y,
        legal: false,
        blocked: false,
        previewed: false,
        topacity: 1,
      });
    });
    // Landscape phones (PID-308): the trick being played lies on the cross;
    // each seat's earlier cards this hand trail behind its card, smaller and
    // shaded, all still there to be counted. With "Help me keep count" on,
    // the point cards in the trail keep their light.
    REL.forEach((rel) => {
      const cards = played[rel] ?? [];
      const live = cards.filter((tc) => trickNo(tc) === liveTrick);
      const earlier = cards.filter((tc) => trickNo(tc) !== liveTrick);
      cards.forEach((tc, i) => {
        let target = playedCardTarget(L, rel, i, cards.length);
        let shade = false;
        if (L.front) {
          const li = live.indexOf(tc);
          if (li >= 0) target = playedCardTarget(L, rel, li, live.length);
          else {
            target = trailSpot(L, rel, earlier.length - earlier.indexOf(tc));
            shade = !(model.countHelp && POINT_RANKS.has(tc.card.rank));
          }
        }
        const seat = L.seats[rel];
        desired.push({
          key: tc.key,
          textureKey: tc.textureKey,
          kind: 'played',
          z: 100 + i,
          delayOrder: i,
          tx: target.x,
          ty: target.y,
          trot: target.rot,
          tscale: target.scale,
          ox: seat.x,
          oy: seat.y,
          legal: false,
          blocked: shade,
          previewed: false,
          topacity: 1,
          ownPlay: rel === 'south',
          completed: !tc.isCurrentTrick,
        });
      });
    });

    const desiredKeys = new Set(desired.map((d) => d.key));
    const winnerCutKey = model.dealerRelative
      ? model.dealerCuts[model.dealerRelative]?.key
      : undefined;
    const nextCutSequenceKey =
      model.phase === 'dealer_selection'
        ? desired
            .filter((card) => card.kind === 'cut')
            .map((card) => `${card.key}:${card.tx}:${card.ty}`)
            .join('|')
        : null;
    const newCutSequence =
      !reduceMotion && !!nextCutSequenceKey && nextCutSequenceKey !== cutSequenceKey.current;
    if (newCutSequence) {
      cutSequenceStartedAt.current = Date.now();
      // The server deals once its window is up: a phone behind it plays the
      // cut faster, or, too far behind, lays the cards down with the winner lit.
      cutPace.current = catchUpPace({
        motionMs: cutRevealAt(Object.keys(model.dealerCuts).length),
        holdMs: CUT_WINNER_READ_MS,
        windowMs: model.dealerSelectionMs,
        lateMs: model.arrivedAt != null ? Date.now() - model.arrivedAt : 0,
      });
    }
    const animateCutSequence = newCutSequence && cutPace.current > 0;
    const skipCutSequence = newCutSequence && cutPace.current === 0;
    cutSequenceKey.current = nextCutSequenceKey;
    const nextSlots: SlotInfo[] = Array(MAX).fill(null);

    // A card is unique within a hand. Re-key its slot before retirement so a
    // confirmation (or rollback) continues from the exact on-screen position.
    for (const d of desired) {
      if (d.kind !== 'played' || model.phase !== 'playing' || keyToSlot.current.has(d.key))
        continue;
      const old = slots.findIndex(
        (slot) =>
          slot?.textureKey === d.textureKey &&
          (slot.kind === 'hand' || (slot.kind === 'played' && slot.key === slot.textureKey)) &&
          !desiredKeys.has(slot.key)
      );
      if (old < 0 || !slots[old]) continue;
      const oldKey = slots[old]!.key;
      const timer = retirementTimers.current.get(oldKey);
      if (timer) clearTimeout(timer);
      retirementTimers.current.delete(oldKey);
      keyToSlot.current.delete(oldKey);
      keyToSlot.current.set(d.key, old);
    }

    // Retire slots only when cards leave the server's round history. Completed
    // tricks remain visible unless the optional sweep has collected them.
    for (const [key, sl] of Array.from(keyToSlot.current.entries())) {
      if (!desiredKeys.has(key)) {
        nextSlots[sl] = slots[sl];
        if (retirementTimers.current.has(key)) continue;

        cancelAnimation(flight[sl]);
        cancelAnimation(collection[sl]);
        // SeatLayer takes over your folded cards as backs in the same frame.
        const folding = slots[sl]?.kind === 'hand' && model.seats.south?.out;
        const duration = folding ? 0 : 180;
        sop[sl].value = folding ? 0 : withTiming(0, { duration });

        retirementTimers.current.set(
          key,
          setTimeout(() => {
            retirementTimers.current.delete(key);
            if (keyToSlot.current.get(key) !== sl) return;
            keyToSlot.current.delete(key);
            setSlots((current) => {
              if (current[sl]?.key !== key) return current;
              const released = [...current];
              released[sl] = null;
              return released;
            });
          }, duration)
        );
      }
    }
    const used = new Set(keyToSlot.current.values());
    const allocate = () => {
      for (let i = 0; i < MAX; i++)
        if (!used.has(i)) {
          used.add(i);
          return i;
        }
      return -1;
    };

    const ht: HandTarget[] = [];
    const bt: (HandTarget & { code: DiagnosticCode })[] = [];
    const cfg = { duration: 320, easing: Easing.out(Easing.cubic) };
    const playCfg = { duration: PLAY_CARD_TRAVEL_MS, easing: motionEasing(PLAY_CARD_CURVE) };
    const dealCfg = {
      duration: packetDeal ? DEAL_PACKET_TRAVEL_MS : DEAL_CARD_TRAVEL_MS,
      easing: Easing.out(Easing.back(1.5)),
    };

    for (const d of desired) {
      const retirementTimer = retirementTimers.current.get(d.key);
      if (retirementTimer) {
        clearTimeout(retirementTimer);
        retirementTimers.current.delete(d.key);
      }
      let sl = keyToSlot.current.get(d.key);
      const isNew = sl === undefined;
      const dealCard = isDeal && d.kind === 'hand';
      const cutCard = d.kind === 'cut' && animateCutSequence;
      if (sl === undefined) {
        sl = allocate();
        if (sl < 0) continue;
        keyToSlot.current.set(d.key, sl);
        const comesFromSeat = d.kind === 'played' || d.kind === 'cut';
        const startX = cutCard
          ? d.ox
          : firstLoad
            ? d.tx
            : dealCard
              ? deckX
              : comesFromSeat
                ? d.ox
                : d.tx;
        const startY = cutCard
          ? d.oy
          : firstLoad
            ? d.ty
            : dealCard
              ? deckY
              : comesFromSeat
                ? d.oy
                : d.ty;
        cancelAnimation(sx[sl]);
        cancelAnimation(sy[sl]);
        cancelAnimation(srot[sl]);
        cancelAnimation(sscale[sl]);
        sx[sl].value = startX;
        sy[sl].value = startY;
        srot[sl].value = dealCard ? 0 : d.trot;
        sscale[sl].value = dealCard
          ? 0.6
          : cutCard
            ? 0.72
            : !firstLoad && comesFromSeat
              ? 1
              : d.tscale;
        sop[sl].value = dealCard || cutCard ? 0 : d.topacity;
        flight[sl].value = 1;
        collection[sl].value = 0;
      }
      const ownLanding = d.ownPlay && slots[sl]?.kind === 'hand';
      const lift = d.ownPlay ? PLAY_CARD_LIFT : OPPONENT_CARD_LIFT;
      const collectTo = isNew ? undefined : slots[sl]?.collectTo;
      nextSlots[sl] = {
        key: d.key,
        textureKey: d.textureKey,
        kind: d.kind,
        z: d.z,
        legal: d.legal,
        blocked: d.blocked,
        winner: d.kind === 'cut' && d.key === winnerCutKey,
        leading: d.kind === 'played' && d.key === model.winningKey,
        flashing: d.kind === 'played' && d.key === flashKey.current,
        previewed: d.previewed,
        lift,
        collectTo,
      };

      const pressed = pressSlot.value === sl;
      const signature = `${d.kind}:${d.tx}:${d.ty}:${d.trot}:${d.tscale}:${d.topacity}`;
      const targetChanged = targets.current.get(sl) !== signature || isNew;
      const playingFlight =
        model.phase === 'playing' && (d.kind === 'played' || slots[sl]?.kind === 'played');
      targets.current.set(sl, signature);
      if (cutCard && !reduceMotion) {
        const pace = cutPace.current;
        const delay = d.delayOrder * CUT_CARD_STAGGER_MS * pace;
        const cutCfg = {
          duration: CUT_CARD_TRAVEL_MS * pace,
          easing: Easing.out(Easing.back(1.35)),
          reduceMotion: ReduceMotion.System,
        };
        sx[sl].value = withDelay(delay, withTiming(d.tx, cutCfg));
        sy[sl].value = withDelay(delay, withTiming(d.ty, cutCfg));
        srot[sl].value = withDelay(delay, withTiming(d.trot, cutCfg));
        sscale[sl].value = withDelay(delay, withTiming(d.tscale, cutCfg));
        sop[sl].value = withDelay(
          delay,
          withTiming(d.topacity, { duration: 150, reduceMotion: ReduceMotion.System })
        );
      } else if (
        firstLoad ||
        (d.kind === 'cut' && skipCutSequence) ||
        (reduceMotion && (d.kind === 'cut' || model.phase === 'playing'))
      ) {
        sx[sl].value = d.tx;
        sy[sl].value = d.ty;
        srot[sl].value = d.trot;
        sscale[sl].value = d.tscale;
        sop[sl].value = d.topacity;
        flight[sl].value = 1;
        if (ownLanding) playSelectionHaptic();
      } else if (d.kind === 'cut' && model.phase === 'dealer_selection') {
        // A dealer snapshot can re-render while this sequence is in flight
        // (notably React Strict Mode and when the dealer field arrives). Keep
        // the original delayed animations instead of collapsing all cards to
        // their targets on that second pass.
      } else if (isNew && dealCard) {
        const delay = packetDeal
          ? (d.delayOrder % 3) * DEAL_PACKET_CARD_STAGGER_MS
          : d.delayOrder * DEAL_CARD_STAGGER_MS;
        sx[sl].value = withDelay(delay, withTiming(d.tx, dealCfg));
        // Keep the landing above the south nameplate; put the soft overshoot
        // in scale/x rather than diving past the hand's baseline.
        sy[sl].value = withDelay(
          delay,
          withTiming(d.ty, {
            ...dealCfg,
            easing: Easing.out(Easing.cubic),
          })
        );
        srot[sl].value = withDelay(delay, withTiming(d.trot, dealCfg));
        sscale[sl].value = withDelay(delay, withTiming(d.tscale, dealCfg));
        sop[sl].value = withDelay(delay, withTiming(d.topacity, { duration: 140 }));
      } else if (isSorting && d.kind === 'hand' && prev?.yourHand[d.delayOrder]?.key !== d.key) {
        // A small lift lets crossing cards read as a shuffle, then they nestle
        // into the straight, suit-sorted row. No permanent fan or rotation.
        const delay = d.delayOrder * 8;
        sx[sl].value = withDelay(
          delay,
          withTiming(d.tx, {
            duration: DEAL_SORT_DURATION_MS - 64,
            easing: Easing.out(Easing.back(1.15)),
          })
        );
        sy[sl].value = withSequence(
          withTiming(d.ty - cardH * 0.12, { duration: 120 }),
          withTiming(d.ty, { duration: 440, easing: Easing.out(Easing.back(1.2)) })
        );
        sscale[sl].value = withSequence(
          withTiming(d.tscale * 1.035, { duration: 120 }),
          withTiming(d.tscale, { duration: 440 })
        );
      } else if (
        !pressed &&
        targetChanged &&
        !collectTo &&
        !(
          d.kind === 'hand' &&
          model.dealStage &&
          model.dealStage === prev?.dealStage &&
          sameHand &&
          prevLayout.current === L
        )
      ) {
        const motion = playingFlight ? playCfg : cfg;
        if (playingFlight) {
          // A refusal can arrive mid-flight: start the return at the drawn
          // position, including the lift, rather than jumping to its baseline.
          sy[sl].value -= Math.sin(Math.PI * flight[sl].value) * cardH * (slots[sl]?.lift ?? lift);
          flight[sl].value = 0;
          flight[sl].value = withTiming(1, playCfg, (finished) => {
            if (finished && ownLanding) runOnJS(playSelectionHaptic)();
          });
        }
        const closingHand = d.kind === 'hand' && model.phase === 'playing' && !playingFlight;
        // Start springs on a frame timestamp too, never an earlier web rAF.
        sx[sl].value = closingHand
          ? withDelay(0, withSpring(d.tx, HAND_CLOSE_SPRING))
          : withTiming(d.tx, motion);
        sy[sl].value = closingHand
          ? withDelay(0, withSpring(d.ty, HAND_CLOSE_SPRING))
          : withTiming(d.ty, motion);
        srot[sl].value = closingHand
          ? withDelay(0, withSpring(d.trot, HAND_CLOSE_SPRING))
          : withTiming(d.trot, motion);
        const raisedScale = d.ownPlay
          ? Math.max(
              sscale[sl].value,
              (handTargets.value.find((t) => t.slot === sl)?.scale ?? handScale) * PLAY_CARD_SCALE
            )
          : sscale[sl].value * OPPONENT_CARD_SCALE;
        sscale[sl].value =
          playingFlight && d.kind === 'played'
            ? withSequence(
                withTiming(raisedScale, {
                  duration: PLAY_CARD_LIFT_MS,
                  easing: motionEasing(PLAY_CARD_LIFT_CURVE),
                }),
                withTiming(d.tscale, {
                  ...playCfg,
                  duration: PLAY_CARD_TRAVEL_MS - PLAY_CARD_LIFT_MS,
                })
              )
            : closingHand
              ? withDelay(0, withSpring(d.tscale, HAND_CLOSE_SPRING))
              : withTiming(d.tscale, motion);
        sop[sl].value = withTiming(d.topacity, { duration: 150 });
      }

      // Keep the history slots, but collect only newly completed tricks. A
      // reconnect never replays old wins, and new plays never restart a sweep.
      if (
        TRICK_SWEEP_ENABLED &&
        d.completed &&
        model.collectAt !== undefined &&
        Number.isFinite(model.collectAt) &&
        !collectTo
      ) {
        const result = model.lastTrick;
        const newlyCompleted =
          !firstLoad &&
          result &&
          (result.number !== prev?.lastTrick?.number || prev?.collectAt === Infinity);
        const inLastTrick = result?.plays.some(({ card }) => cardKey(card) === d.textureKey);
        const seat = L.seats[result?.winner ?? 'north'];
        nextSlots[sl]!.collectTo = { x: seat.x, y: seat.y };
        if (!newlyCompleted || !inLastTrick) {
          collection[sl].value = 1;
        } else {
          collection[sl].value = withDelay(
            Math.max(0, model.collectAt - Date.now()),
            reduceMotion
              ? withTiming(1, { duration: 0, reduceMotion: ReduceMotion.Never })
              : withSequence(
                  withTiming(TRICK_GATHER_PROGRESS, {
                    duration: TRICK_GATHER_MS,
                    easing: motionEasing(TRICK_GATHER_CURVE),
                  }),
                  withTiming(1, {
                    duration: TRICK_SWEEP_MS,
                    easing: motionEasing(TRICK_SWEEP_CURVE),
                  })
                ),
            ReduceMotion.Never
          );
        }
      }

      if (d.kind === 'hand' && d.legal)
        ht.push({
          slot: sl,
          key: d.key,
          x: d.tx,
          y: d.ty,
          w: cardW * handScale,
          h: cardH * handScale,
          scale: d.tscale,
        });
      if (d.kind === 'hand' && !d.legal)
        bt.push({
          slot: sl,
          key: d.key,
          x: d.tx,
          y: d.ty,
          w: cardW * handScale,
          h: cardH * handScale,
          scale: d.tscale,
          code:
            model.phase !== 'playing'
              ? 'invalid_phase'
              : model.canPlay
                ? 'illegal_action'
                : 'not_your_turn',
        });
    }

    handTargets.value = ht;
    blockedTargets.value = bt;
    setSlots(nextSlots);
    prevModel.current = model;
    prevLayout.current = L;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, L, enabled, reduceMotion, previewSuit]);

  useEffect(() => {
    const cutCount = model ? Object.keys(model.dealerCuts).length : 0;
    const sequenceKey = cutSequenceKey.current;
    if (!enabled || model?.phase !== 'dealer_selection' || !sequenceKey || cutCount === 0) {
      cancelAnimation(winnerReveal);
      winnerReveal.value = 0;
      winnerRevealSequenceKey.current = null;
      return;
    }
    if (!model.dealerRelative || !model.dealerCuts[model.dealerRelative]) {
      if (winnerRevealSequenceKey.current !== sequenceKey) {
        cancelAnimation(winnerReveal);
        winnerReveal.value = 0;
        winnerRevealSequenceKey.current = null;
      }
      return;
    }
    if (winnerRevealSequenceKey.current === sequenceKey) return;

    cancelAnimation(winnerReveal);
    winnerReveal.value = 0;
    winnerRevealSequenceKey.current = sequenceKey;
    if (reduceMotion) {
      winnerReveal.value = 1;
      return;
    }
    const revealAtMs = cutRevealAt(cutCount) * cutPace.current;
    const revealDelay = Math.max(0, revealAtMs - (Date.now() - cutSequenceStartedAt.current));
    winnerReveal.value = withDelay(
      revealDelay,
      withSequence(
        withTiming(1, {
          duration: 260,
          easing: Easing.out(Easing.back(1.8)),
          reduceMotion: ReduceMotion.System,
        }),
        withTiming(0.78, { duration: 180, reduceMotion: ReduceMotion.System }),
        withTiming(1, { duration: 220, reduceMotion: ReduceMotion.System })
      )
    );
  }, [enabled, model, reduceMotion, winnerReveal]);

  // The glow lands with the card that earned it, pops a touch past full
  // and settles. Each new leader pops again.
  const leadKey = model?.winningKey ?? null;
  useEffect(() => {
    cancelAnimation(leadGlow);
    if (!leadKey) {
      leadGlow.value = 0;
      return;
    }
    if (reduceMotion || isStillCapture()) {
      leadGlow.value = 1;
      return;
    }
    leadGlow.value = 0;
    leadGlow.value = withDelay(
      LEAD_GLOW_DELAY_MS,
      withSequence(
        withTiming(1.25, { duration: 220, easing: Easing.out(Easing.back(1.6)) }),
        withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) })
      )
    );
  }, [leadKey, reduceMotion, leadGlow]);

  const playByKey = useCallback((key: string) => {
    const card = modelRef.current?.yourHand.find((c) => c.key === key)?.card;
    cardTap(() => {
      if (card && onPlayRef.current) onPlayRef.current(card);
      else blockedPlay('stale');
    });
  }, []);

  const gesture = useMemo(() => {
    const hit = (px: number, py: number): HandTarget | null => {
      'worklet';
      const ts = handTargets.value;
      for (let i = ts.length - 1; i >= 0; i--) {
        const t = ts[i];
        if (Math.abs(px - t.x) < t.w / 2 + 6 && Math.abs(py - t.y) < t.h / 2 + 6) return t;
      }
      return null;
    };
    const target = (slot: number): HandTarget | null => {
      'worklet';
      const ts = handTargets.value;
      for (let i = 0; i < ts.length; i++) if (ts[i].slot === slot) return ts[i];
      return null;
    };
    const settle = (slot: number, delay: number) => {
      'worklet';
      const t = target(slot);
      if (!t) return;
      sy[slot].value = withDelay(delay, withTiming(t.y, { duration: PRESS_SETTLE_MS }));
      sscale[slot].value = withDelay(delay, withTiming(t.scale, { duration: PRESS_SETTLE_MS }));
    };

    // One tap plays a legal card, the way a button works: the card lifts as
    // the finger lands, plays as it lifts, and sliding off before then lets
    // go without playing. No drag: it raced the tap, so a slightly moving
    // finger turned a tap into a tiny drag that sprang back. No time limit,
    // so a slow, careful press still counts.
    return Gesture.Tap()
      .maxDuration(PRESS_MAX_MS)
      .maxDistance(PRESS_SLOP)
      .onBegin((e) => {
        'worklet';
        blockedPress.value = null;
        const t = hit(e.x, e.y);
        if (!t) {
          const ts = blockedTargets.value;
          for (let i = ts.length - 1; i >= 0; i--) {
            const b = ts[i];
            if (Math.abs(e.x - b.x) < b.w / 2 + 6 && Math.abs(e.y - b.y) < b.h / 2 + 6) {
              blockedPress.value = b.code;
              break;
            }
          }
          return;
        }
        pressSlot.value = t.slot;
        pressKey.value = t.key;
        sy[t.slot].value = withTiming(t.y - t.h * PRESS_LIFT, { duration: PRESS_LIFT_MS });
        sscale[t.slot].value = withTiming(t.scale * 1.06, { duration: PRESS_LIFT_MS });
      })
      .onEnd((_e, success) => {
        'worklet';
        if (success && pressSlot.value >= 0) runOnJS(playByKey)(pressKey.value);
        else if (success && blockedPress.value) runOnJS(blockedCardTap)(blockedPress.value);
      })
      .onFinalize((_e, success) => {
        'worklet';
        const slot = pressSlot.value;
        if (slot < 0) return;
        pressSlot.value = -1;
        // A played card flies from where it is; if the play never happens
        // (not your turn after all, or the table is still settling), it
        // drops back into the hand.
        settle(slot, success ? PRESS_UNPLAYED_MS : 0);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playByKey]);

  // Every card's shadow and gold glow, blurred once per card size.
  useKeptBlurs();
  const lights = useMemo(() => {
    const r = Math.min(10, cardW * 0.12);
    return {
      glow: keptBlur(
        { x: -cardW / 2 - 5, y: -cardH / 2 - 5, width: cardW + 10, height: cardH + 10, r: r + 5 },
        14,
        T.gold
      ),
      shadow: keptBlur(
        { x: -cardW / 2 + 1, y: -cardH / 2 + 4, width: cardW, height: cardH, r },
        5,
        CARD_SHADOW
      ),
    };
  }, [cardW, cardH]);

  const nodes = useMemo(() => {
    const ordered = slots
      .map((s, i) => ({ s, i }))
      .filter((x): x is { s: NonNullable<SlotInfo>; i: number } => x.s !== null)
      .sort((a, b) => a.s.z - b.s.z);
    return (
      <>
        {ordered.map(({ s, i }) => (
          <CardSprite
            key={i}
            img={textures?.get(s.textureKey) ?? null}
            x={sx[i]}
            y={sy[i]}
            scale={sscale[i]}
            rot={srot[i]}
            opacity={sop[i]}
            flight={flight[i]}
            lift={s.lift}
            collection={collection[i]}
            collectTo={s.collectTo}
            center={{ x: L.trick.cx, y: L.trick.cy }}
            w={cardW}
            h={cardH}
            dimmed={s.blocked}
            winner={s.winner}
            winnerReveal={winnerReveal}
            leading={s.leading}
            leadGlow={leadGlow}
            flashing={s.flashing}
            flashGlow={flashGlow}
            previewed={s.previewed}
            lights={lights}
          />
        ))}
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, textures, cardW, cardH, L, lights]);

  const renderedPlayedCardCount = slots.reduce(
    (count, slot) => count + (slot?.kind === 'played' ? 1 : 0),
    0
  );
  const renderedCutCardCount = slots.reduce(
    (count, slot) => count + (slot?.kind === 'cut' ? 1 : 0),
    0
  );
  const renderedHandCardCount = slots.reduce(
    (count, slot) => count + (slot?.kind === 'hand' ? 1 : 0),
    0
  );

  useEffect(() => {
    if (!__DEV__) return;
    const debug = globalThis as { __pidroCardMotion?: () => unknown };
    debug.__pidroCardMotion = () =>
      slots.flatMap((slot, i) =>
        slot
          ? [
              {
                key: slot.key,
                kind: slot.kind,
                x: sx[i].value,
                y: sy[i].value,
                width: cardW,
                height: cardH,
                rotation: srot[i].value,
                scale: sscale[i].value,
                renderedScale:
                  sscale[i].value *
                  (slot.winner
                    ? 1 + winnerReveal.value * 0.1
                    : slot.leading
                      ? 1 + leadGlow.value * 0.06
                      : 1),
                leading: slot.leading,
                flight: flight[i].value,
                opacity: sop[i].value,
                collection: collection[i].value,
                collectTo: slot.collectTo,
              },
            ]
          : []
      );
    return () => {
      delete debug.__pidroCardMotion;
    };
    // Dev-only sampling reads the UI values on demand, never through React per frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  return {
    gesture,
    nodes,
    trumpPop,
    renderedCutCardCount,
    renderedPlayedCardCount,
    renderedHandCardCount,
    handTargets,
    spriteKeys: slots.map((slot) => slot?.key ?? null),
  };
}

function CardSprite({
  img,
  x,
  y,
  scale,
  rot,
  opacity,
  flight,
  lift,
  collection,
  collectTo,
  center,
  w,
  h,
  dimmed,
  winner,
  winnerReveal,
  leading,
  leadGlow,
  flashing,
  flashGlow,
  previewed,
  lights,
}: {
  img: SkImage | null;
  x: SharedValue<number>;
  y: SharedValue<number>;
  scale: SharedValue<number>;
  rot: SharedValue<number>;
  opacity: SharedValue<number>;
  flight: SharedValue<number>;
  lift: number;
  collection: SharedValue<number>;
  collectTo?: { x: number; y: number };
  center: { x: number; y: number };
  w: number;
  h: number;
  dimmed: boolean;
  winner: boolean;
  winnerReveal: SharedValue<number>;
  leading: boolean;
  leadGlow: SharedValue<number>;
  flashing: boolean;
  flashGlow: SharedValue<number>;
  previewed: boolean;
  lights: { glow: BakedBlur | null; shadow: BakedBlur | null };
}) {
  const sweep = useDerivedValue(() =>
    Math.max(0, (collection.value - TRICK_GATHER_PROGRESS) / (1 - TRICK_GATHER_PROGRESS))
  );
  const transform = useDerivedValue(() => {
    const gather = Math.min(1, collection.value / TRICK_GATHER_PROGRESS);
    return [
      {
        translateX:
          x.value +
          (center.x - x.value) * gather +
          ((collectTo?.x ?? center.x) - center.x) * sweep.value,
      },
      {
        translateY:
          y.value +
          (center.y - y.value) * gather +
          ((collectTo?.y ?? center.y) - center.y) * sweep.value -
          Math.sin(Math.PI * flight.value) * h * lift,
      },
      { rotate: rot.value * (1 - gather) },
      {
        scale:
          scale.value *
          (1 - (1 - TRICK_SWEEP_SCALE) * sweep.value) *
          (winner ? 1 + winnerReveal.value * 0.1 : leading ? 1 + leadGlow.value * 0.06 : 1),
      },
    ];
  });
  const visible = useDerivedValue(() => opacity.value * (1 - sweep.value));
  const winnerOpacity = useDerivedValue(() =>
    Math.max(
      winner ? winnerReveal.value : leading ? leadGlow.value * 0.85 : 0,
      flashing ? flashGlow.value : 0
    )
  );
  const r = Math.min(10, w * 0.12);
  // Only these cards ever glow; for the rest the glow is never drawn at all.
  const glows = winner || leading || flashing;
  return (
    <Group transform={transform} opacity={visible}>
      {glows && lights.glow && <Baked blur={lights.glow} opacity={winnerOpacity} />}
      {/* Soft drop shadow grounds the card on the felt. */}
      {lights.shadow && <Baked blur={lights.shadow} />}
      {img ? (
        <Image image={img} x={-w / 2} y={-h / 2} width={w} height={h} fit="cover" />
      ) : (
        <RoundedRect x={-w / 2} y={-h / 2} width={w} height={h} r={r} color={T.cardFrame} />
      )}
      {/* Unplayable cards darken; playable ones stay bright and lifted. */}
      {dimmed && (
        <RoundedRect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          r={r}
          color="rgba(6, 22, 38, 0.52)"
        />
      )}
      {glows && (
        <RoundedRect
          x={-w / 2 - 2}
          y={-h / 2 - 2}
          width={w + 4}
          height={h + 4}
          r={r + 2}
          color={T.goldLight}
          style="stroke"
          strokeWidth={3}
          opacity={winnerOpacity}
        />
      )}
      {previewed && (
        <RoundedRect
          x={-w / 2 - 1}
          y={-h / 2 - 1}
          width={w + 2}
          height={h + 2}
          r={r + 1}
          color={T.gold}
          style="stroke"
          strokeWidth={2}
        />
      )}
    </Group>
  );
}

const CARD_SHADOW = 'rgba(2, 14, 28, 0.38)';

function Baked({ blur, opacity }: { blur: BakedBlur; opacity?: SharedValue<number> }) {
  return (
    <Image
      image={blur.image}
      x={blur.x}
      y={blur.y}
      width={blur.width}
      height={blur.height}
      fit="fill"
      opacity={opacity}
    />
  );
}
