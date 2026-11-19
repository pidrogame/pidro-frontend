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
 *   • deal-in   — hand grows from empty → stagger from the dealer's pack w/ overshoot
 *   • history   — completed tricks keep stable slots for the server's round history
 *   • trump     — null→suit pops the trump glyph (exposed via `trumpPop`)
 *   • reflow    — layout change tweens sprites to new slots (falls out of the effect)
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { Group, Image, rect, RoundedRect, rrect, type SkImage } from '@shopify/react-native-skia';
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
import { retarget } from '@/features/game/heldCard';
import { cardUnder } from '@/features/game/handTap';
import { isStillCapture } from '@/utils/stillCapture';
import { playSelectionHaptic } from '@/utils/haptics';
import { cutSoundKey, shuffleAtMs } from '@/features/game/sounds';
import { play } from '../sounds';
import { blockedCardTap, blockedPlay, cardTap } from '@/diagnostics/actions';
import type { DiagnosticCode } from '@/diagnostics/buffer';
import {
  handLift,
  handScale as handScaleFor,
  handStep,
  laidPileTarget,
  killedSpot,
  playedCardTarget,
  trailSpot,
  trickOnCross,
  type RelativePosition,
  type TableLayout,
  heldPose,
  HELD_STYLE,
  packSpot,
} from './layout';
import type { TableCard, TableModel } from './tableModel';
import { largeFaceSampling, type CardKey, type CardTextures } from './cardTextures';
import { cardKey } from './cardKey';
import {
  CUT_CARD_STAGGER_MS,
  CUT_CARD_TRAVEL_MS,
  CUT_ORDER,
  CUT_WINNER_READ_MS,
  cutLandsAt,
  cutRevealAt,
  DEAL_CARD_STAGGER_MS,
  DEAL_CARD_TRAVEL_MS,
  DEAL_PACKET_CARD_STAGGER_MS,
  DEAL_PACKET_TRAVEL_MS,
  DEAL_SORT_DURATION_MS,
  PLAY_CARD_TRAVEL_MS,
  PILE_SETTLE_MS,
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
  LAY_DOWN_FLIGHT_MS,
  layDownAt,
  SECOND_DEAL_FLIGHT_MS,
  SECOND_DEAL_SWOOP_STAGGER_MS,
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
/** A tap the table did not play shakes its card this far, as a share of its width. */
const SHAKE = 0.06;
/** A, J, 10, 5 and 2: the cards that score in Pidro. */
const POINT_RANKS = new Set([14, 11, 10, 5, 2]);
const REL: RelativePosition[] = ['north', 'east', 'south', 'west'];

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
  /** Counts the cards this slot has held: a new card is a new sprite (PID-473). */
  born: number;
  /** In your hand, or played from it: drawn by your hand's size (PID-467). */
  yours: boolean;
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
  /** The hand card that starts the next suit, or the side suits after the trumps: its slot. */
  caster?: number;
  lift: number;
  collectTo?: { x: number; y: number };
} | null;

type Opts = {
  model?: TableModel;
  textures?: CardTextures;
  L: TableLayout;
  onPlayCard?: (card: Card) => void;
  onBlockedPlay?: (reason: string) => void;
  /** Each new count shakes the card last tapped. */
  nudge?: number;
  enabled: boolean;
  /** Picking trump: the suit under the finger, whose trumps lift in the hand. */
  previewSuit?: Suit | null;
  /**
   * Each seat's cards on their way that the canvas does not show yet, for the
   * table it has counted: its backs wait for them.
   */
  onArriving?: (seats: TableModel['seats'], arriving: Arriving) => void;
};

export type Arriving = Partial<Record<RelativePosition, number>>;
/** A killed trump turns this far in its throw, as a second deal's cards do. */
const KILLED_TURN = (25 * Math.PI) / 180;
type Seats = TableModel['seats'];
type Counted = { seats: Seats; arriving: Arriving };

/**
 * A seat's backs, and the cards that have not yet shown themselves leaving
 * them (PID-473). A seat that went out with such a card folds once it shows.
 */
export function withArriving(seats: Seats, arriving: Arriving): Seats {
  if (!Object.keys(arriving).length) return seats;
  return Object.fromEntries(
    Object.entries(seats).map(([rel, seat]) => {
      const n = arriving[rel as RelativePosition];
      return [
        rel,
        seat && n
          ? {
              ...seat,
              cardCount: (seat.cardCount ?? 0) + (seat.out ? seat.foldedCount : 0) + n,
              out: false,
              foldedCount: 0,
            }
          : seat,
      ];
    })
  ) as Seats;
}

const backs = (seat: Seats[RelativePosition]) => (seat?.out ? 0 : (seat?.cardCount ?? 0));

/** The seats as the canvas last counted them; a newer table loses no back and folds no seat. */
function seatBacks(seats: Seats, counted: Counted): Seats {
  const was = withArriving(counted.seats, counted.arriving);
  if (counted.seats === seats) return was;
  return Object.fromEntries(
    Object.entries(seats).map(([rel, seat]) => {
      const before = was[rel as RelativePosition];
      return [
        rel,
        seat && before && backs(seat) < backs(before)
          ? {
              ...seat,
              cardCount: before.cardCount,
              out: before.out,
              foldedCount: before.foldedCount,
            }
          : seat,
      ];
    })
  ) as Seats;
}

const sameBacks = (a: Seats, b: Seats) =>
  Object.keys({ ...a, ...b }).every((rel) => {
    const [x, y] = [a[rel as RelativePosition], b[rel as RelativePosition]];
    return (
      x?.cardCount === y?.cardCount && !!x?.out === !!y?.out && x?.foldedCount === y?.foldedCount
    );
  });

/**
 * The seats with the backs the canvas counted (PID-473). A phone can show the
 * seats of a new table before the canvas has taken it in, and only the canvas
 * knows which cards still have to show: until it has counted, every seat keeps
 * the backs it showed. Redraws only when the backs change.
 */
export function useSeatBacks(seats: Seats) {
  const counted = useRef<Counted>({ seats, arriving: {} });
  const [, redraw] = useState(0);
  const onCounted = useCallback((of: Seats, arriving: Arriving) => {
    const before = seatBacks(of, counted.current);
    counted.current = { seats: of, arriving };
    if (!sameBacks(before, seatBacks(of, counted.current))) redraw((n) => n + 1);
  }, []);
  return [seatBacks(seats, counted.current), onCounted] as const;
}

export function useCardSprites({
  model,
  textures,
  L,
  onPlayCard,
  onBlockedPlay,
  nudge = 0,
  enabled,
  previewSuit = null,
  onArriving,
}: Opts) {
  /* eslint-disable react-hooks/rules-of-hooks -- fixed-length pools → stable hook order */
  const sx = Array.from({ length: MAX }, () => useSharedValue(0));
  const sy = Array.from({ length: MAX }, () => useSharedValue(0));
  const sscale = Array.from({ length: MAX }, () => useSharedValue(1));
  const srot = Array.from({ length: MAX }, () => useSharedValue(0));
  const sop = Array.from({ length: MAX }, () => useSharedValue(0));
  const flight = Array.from({ length: MAX }, () => useSharedValue(1));
  const collection = Array.from({ length: MAX }, () => useSharedValue(0));
  /** How far a shaded card's shade has come in: upright piles fade it in (PID-381). */
  const sshade = Array.from({ length: MAX }, () => useSharedValue(0));
  /**
   * 1 while a finger holds the card up: it lies over every other card. Set on
   * the UI thread, so a card's place never waits for React (PID-461).
   */
  const spress = Array.from({ length: MAX }, () => useSharedValue(0));
  /**
   * Each card's place in the drawing order, set with its motion (PID-473): a
   * busy phone draws the canvas's tree late, and a card flying from your hand
   * must not lie under your pile in the meantime.
   */
  const sz = Array.from({ length: MAX }, () => useSharedValue(0));
  /* eslint-enable react-hooks/rules-of-hooks */

  const [slots, setSlots] = useState<SlotInfo[]>(() => Array(MAX).fill(null));
  const reduceMotion = useReducedMotion();

  const keyToSlot = useRef<Map<string, number>>(new Map());
  const targets = useRef<Map<number, string>>(new Map());
  const retirementTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /**
   * A phone draws a new sprite a while after its values change. Until it has,
   * its motion waits here, by slot, and its seat keeps the card's back (PID-473).
   */
  const departures = useRef<Map<number, () => void>>(new Map());
  const arriving = useRef<Map<number, { rel: RelativePosition; at: number }>>(new Map());
  // A laid card from another seat leaves on the JS clock, so its back goes with it.
  const laidTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const onArrivingRef = useRef(onArriving);
  onArrivingRef.current = onArriving;
  const births = useRef(0);
  const shownBirths = useRef<Map<number, number>>(new Map());
  const cutSounds = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cutSoundSequence = useRef<string | null>(null);
  const cutSequenceKey = useRef<string | null>(null);
  const cutSequenceStartedAt = useRef(0);
  // 1 as designed; less when this phone is behind the server; 0 skips to the result.
  const cutPace = useRef(1);
  const winnerRevealSequenceKey = useRef<string | null>(null);
  const prevModel = useRef<TableModel | null>(null);
  const prevLayout = useRef(L);
  const modelRef = useRef<TableModel | undefined>(model);
  const onPlayRef = useRef(onPlayCard);
  const onBlockedRef = useRef(onBlockedPlay);
  const tappedKey = useRef<string | null>(null);
  modelRef.current = model;
  onPlayRef.current = onPlayCard;
  onBlockedRef.current = onBlockedPlay;

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
      laidTimers.current.forEach(clearTimeout);
      cutSounds.current.forEach(clearTimeout);
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

  const sendArriving = (seats: TableModel['seats'] | undefined) => {
    const counts: Arriving = {};
    for (const { rel } of arriving.current.values()) counts[rel] = (counts[rel] ?? 0) + 1;
    if (seats) onArrivingRef.current?.(seats, counts);
  };
  const unlay = (sl: number) => {
    clearTimeout(laidTimers.current.get(sl));
    laidTimers.current.delete(sl);
  };
  // The canvas has drawn this slot's new sprite: it shows, its motion starts,
  // and the back it leaves goes as it does, or as a laid card leaves (PID-473).
  const depart = (sl: number, born: number) => {
    shownBirths.current.set(sl, born);
    const run = departures.current.get(sl);
    departures.current.delete(sl);
    run?.();
    const leaving = arriving.current.get(sl);
    // A laid card that waits its turn lets its back go as it shows (see `animate`).
    if (leaving && !leaving.at) leave(sl, leaving);
  };
  const leave = (sl: number, leaving: { rel: RelativePosition; at: number } | undefined) => {
    if (!leaving || arriving.current.get(sl) !== leaving) return;
    arriving.current.delete(sl);
    sendArriving(prevModel.current?.seats);
  };

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

    // Both deals come from the pack beside the dealer (PID-394).
    const { x: deckX, y: deckY } = packSpot(L, model.dealerRelative ?? 'south');

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
      /** The next hand card, where it starts another suit. */
      castBy?: string;
      /** A laid-down card (PID-469): when it leaves its seat, or your hand. */
      laidAt?: number;
      /** A trump killed over six (PID-475): when it is thrown onto its pack spot (PID-481). */
      killedAt?: number;
      rel?: RelativePosition;
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
    const keyed = (tc: TableCard) => Number(/^trick-(\d+)-/.exec(tc.key)?.[1] ?? -1);
    // A settled hand's laid cards (PID-366) are no trick of the others': under
    // the result as while they come down, the hand's last trick stays the live one.
    const laid = new Set(model.layDown?.cards.map(cardKey));
    const all = REL.flatMap((rel) => played[rel] ?? []).filter((tc) => !laid.has(tc.textureKey));
    const current = all.filter((tc) => tc.isCurrentTrick);
    const liveTrick = current.some((tc) => keyed(tc) >= 0)
      ? Math.max(...current.map(keyed))
      : Math.max(-1, ...all.map(keyed)) + (current.length ? 1 : 0);
    // The card you just tapped keeps its hand key until the server places it:
    // it is the live trick's card, not one from an earlier trick (PID-460).
    const trickNo = (tc: TableCard) => (tc.isCurrentTrick && keyed(tc) < 0 ? liveTrick : keyed(tc));
    // A card of yours lifts only into your empty spot, never onto your card
    // still lying there from the trick just taken (PID-307).
    const spotTaken = !!L.front && (played.south ?? []).some((tc) => trickNo(tc) === liveTrick);

    // Where the suit changes, and between the trumps and the rest, the next
    // card's shadow deepens on this one (PID-461); not while the deal is unsorted.
    const group = (tc: TableCard) => (tc.isTrump ? 'trump' : tc.card.suit);
    model.yourHand.forEach((tc, i) => {
      const s = handSlot(i);
      const next = model.yourHand[i + 1];
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
        // Raised or not, each card lies over the one before it, so none hides a rank (PID-461).
        z: i,
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
        castBy:
          next && group(next) !== group(tc) && model.dealStage !== 'dealing' ? next.key : undefined,
      });
    });
    CUT_ORDER.forEach((rel, cutIndex) => {
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
    // Landscape phones (PID-308): each seat's latest card lies on the cross; its
    // earlier cards this hand trail behind it, smaller and shaded, all still
    // there to be counted. A card from an earlier trick waits on the cross for
    // its seat's next card, shaded too. With "Count for me" on, point cards
    // keep their light wherever they lie. Upright phones keep their piles on the
    // circle, the latest card in front and the earlier ones behind it (PID-381).
    const upright = L.profile === 'phone-portrait';
    REL.forEach((rel) => {
      // A settled hand's laid cards are the table's own (PID-469): drawn from
      // its textures from their first frame, and keyed alike while they come
      // down and under the result, so one card lies there throughout. Under
      // the result they lie in the hand's piles, and leave with them (PID-476).
      const down = model.layDown?.rel === rel ? model.layDown : null;
      const coming = down?.step === 'fan' ? down.cards : [];
      const laidKey = (key: CardKey) => `trick-laid-0-${rel}-${key}`;
      const onTable = played[rel] ?? [];
      const cards: TableCard[] = [
        ...onTable.map((tc) =>
          laid.has(tc.textureKey) ? { ...tc, key: laidKey(tc.textureKey) } : tc
        ),
        ...coming
          .filter((card) => !onTable.some((tc) => tc.textureKey === cardKey(card)))
          .map((card) => ({
            key: laidKey(cardKey(card)),
            textureKey: cardKey(card),
            card,
            isTrump: true,
            isLegalPlay: false,
            isCurrentTrick: false,
          })),
      ];
      const onCross = trickOnCross(
        cards.map(trickNo),
        liveTrick,
        // Upright, your cards lift in the row, not into your spot: your
        // card stays in front until your next one lands.
        rel === 'south' && !upright,
        model.canPlay,
        !!model.seats[rel]?.out
      );
      const live = cards.filter((tc) => trickNo(tc) === onCross);
      const earlier = cards.filter((tc) => trickNo(tc) !== onCross);
      cards.forEach((tc, i) => {
        let target = playedCardTarget(L, rel, i, cards.length, live.length);
        const counted = model.countHelp && POINT_RANKS.has(tc.card.rank);
        const li = live.indexOf(tc);
        let shade = (!!L.front || upright) && !counted && (li < 0 || onCross !== liveTrick);
        let k = i;
        // The holder's pile makes room for its laid cards, its newest trick, bright.
        const j = down ? down.cards.findIndex((card) => cardKey(card) === tc.textureKey) : -1;
        if (down) {
          if (j >= 0) k = down.played + j;
          target = laidPileTarget(L, rel, down.played, k, down.cards.length);
          shade = (!!L.front || upright) && !counted && k < down.played;
        } else if (L.front)
          target =
            li >= 0
              ? playedCardTarget(L, rel, li, live.length)
              : trailSpot(L, rel, earlier.length - earlier.indexOf(tc), earlier.length);
        const seat = L.seats[rel];
        desired.push({
          key: tc.key,
          textureKey: tc.textureKey,
          kind: 'played',
          z: 100 + k,
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
          rel,
          completed: !tc.isCurrentTrick,
          laidAt: down && j >= 0 ? layDownAt(j, down.cards.length) : undefined,
        });
      });
    });

    // Trumps killed over six lie face up on their seat's pack spot all hand
    // (PID-481), thrown there as a second deal's cards are.
    REL.forEach((rel) => {
      const kills = model.killed?.[rel] ?? [];
      const from = rel === 'south' ? { x: L.hand.cx, y: L.hand.cy } : L.seats[rel];
      kills.forEach((card, i) => {
        const spot = killedSpot(L, rel, i, kills.length);
        desired.push({
          key: `killed-0-0-${rel}-${cardKey(card)}`,
          textureKey: cardKey(card),
          kind: 'played',
          z: 50 + i,
          delayOrder: i,
          tx: spot.x,
          ty: spot.y,
          trot: spot.rot,
          tscale: spot.w / cardW,
          ox: from.x,
          oy: from.y,
          legal: false,
          blocked: false,
          previewed: false,
          topacity: 1,
          rel,
          killedAt: i * SECOND_DEAL_SWOOP_STAGGER_MS,
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
    const cutChanged = !!nextCutSequenceKey && nextCutSequenceKey !== cutSequenceKey.current;
    const newCutSequence = !reduceMotion && cutChanged;
    const nextCutSoundKey =
      model.phase === 'dealer_selection' ? cutSoundKey(model.dealerCuts) : null;
    const cutCount = Object.keys(model.dealerCuts).length;
    const lateMs = model.arrivedAt != null ? Date.now() - model.arrivedAt : 0;
    if (cutChanged) {
      cutSequenceStartedAt.current = Date.now();
      // The server deals once its window is up: a phone behind it plays the
      // cut faster, or, too far behind, lays the cards down with the winner lit.
      cutPace.current = catchUpPace({
        motionMs: cutRevealAt(cutCount),
        holdMs: CUT_WINNER_READ_MS,
        windowMs: model.dealerSelectionMs,
        lateMs,
      });
    }
    // Each cut card sounds as it lands, Reduce Motion or not, and the shuffle
    // leads into the deal the window ends with. A rotation replays the cut's
    // picture, never its sounds.
    if (nextCutSoundKey && nextCutSoundKey !== cutSoundSequence.current) {
      const pace = cutPace.current;
      const landings =
        pace > 0
          ? desired
              .filter((card) => card.kind === 'cut')
              .map((card) => cutLandsAt(card.delayOrder, pace))
          : [];
      const dealsInMs =
        model.dealerSelectionMs != null
          ? model.dealerSelectionMs - lateMs
          : (cutRevealAt(cutCount) + CUT_WINNER_READ_MS) * pace;
      cutSounds.current.forEach(clearTimeout);
      cutSounds.current = [
        ...landings.map((at) => setTimeout(() => play('deal'), at)),
        setTimeout(() => play('shuffle'), shuffleAtMs(dealsInMs, Math.max(0, ...landings))),
      ];
    }
    cutSoundSequence.current = nextCutSoundKey;
    const animateCutSequence = newCutSequence && cutPace.current > 0;
    const skipCutSequence = newCutSequence && cutPace.current === 0;
    cutSequenceKey.current = nextCutSequenceKey;
    const nextSlots: SlotInfo[] = Array(MAX).fill(null);

    // A card is unique within a hand. Re-key its slot before retirement so a
    // confirmation (or rollback) continues from the exact on-screen position.
    for (const d of desired) {
      if (
        d.kind !== 'played' ||
        d.killedAt !== undefined ||
        model.phase !== 'playing' ||
        keyToSlot.current.has(d.key)
      )
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
        // Gone before it was drawn: it fades with the rest, never moves.
        departures.current.delete(sl);
        unlay(sl);
        // SeatLayer takes over your folded cards as backs in the same frame.
        const folding = slots[sl]?.kind === 'hand' && model.seats.south?.out;
        const duration = folding ? 0 : 180;
        const retire = (delay: number) => {
          if (keyToSlot.current.get(key) !== sl) return;
          clearTimeout(retirementTimers.current.get(key));
          sop[sl].value = folding ? 0 : withDelay(delay, withTiming(0, { duration }));
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
            }, delay + duration)
          );
        };
        retire(0);
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
        departures.current.delete(sl);
        unlay(sl);
        arriving.current.delete(sl);
        // Your own cards leave your hand as sprites; a spectator sees South's backs.
        const fromBacks = !d.ownPlay || !model.seats.south?.isYou;
        if (d.kind === 'played' && d.killedAt === undefined && fromBacks && !firstLoad && d.rel)
          arriving.current.set(sl, { rel: d.rel, at: reduceMotion ? 0 : (d.laidAt ?? 0) });
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
        const thrown = d.killedAt !== undefined && !firstLoad && !reduceMotion;
        srot[sl].value = dealCard ? 0 : thrown ? d.trot - KILLED_TURN : d.trot;
        sscale[sl].value = dealCard
          ? 0.6
          : cutCard
            ? 0.72
            : !firstLoad && comesFromSeat && d.killedAt === undefined
              ? 1
              : d.tscale;
        sop[sl].value = dealCard || cutCard ? 0 : d.topacity;
        flight[sl].value = 1;
        collection[sl].value = 0;
      }
      const ownLanding = d.ownPlay && slots[sl]?.kind === 'hand';
      const lift = d.ownPlay ? PLAY_CARD_LIFT : OPPONENT_CARD_LIFT;
      const collectTo = isNew ? undefined : slots[sl]?.collectTo;
      if (isNew || slots[sl]?.z !== d.z) sz[sl].value = d.z;
      nextSlots[sl] = {
        key: d.key,
        textureKey: d.textureKey,
        kind: d.kind,
        born: isNew ? ++births.current : (slots[sl]?.born ?? 0),
        yours: d.kind === 'hand' || !!d.ownPlay,
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

      const signature = `${d.kind}:${d.tx}:${d.ty}:${d.trot}:${d.tscale}:${d.topacity}`;
      const { move, record } = retarget({
        recorded: isNew ? undefined : targets.current.get(sl),
        signature,
        pressed: pressSlot.value === sl,
        kind: d.kind,
      });
      const playingFlight =
        model.phase === 'playing' && (d.kind === 'played' || slots[sl]?.kind === 'played');
      if (record) targets.current.set(sl, signature);
      // Upright phones (PID-381): a card lying in its pile settles back in
      // place, smaller and shaded, as its seat's next card lands; in one short
      // motion, or at once where the table itself moved.
      const settles =
        upright &&
        !isNew &&
        !firstLoad &&
        !reduceMotion &&
        d.kind === 'played' &&
        slots[sl]?.kind === 'played' &&
        flight[sl].value === 1;
      const settleAt = prevLayout.current === L ? PLAY_CARD_TRAVEL_MS : 0;
      const settle = { duration: PILE_SETTLE_MS, easing: Easing.out(Easing.cubic) };
      if (isNew || d.blocked !== slots[sl]?.blocked)
        sshade[sl].value = settles
          ? withDelay(settleAt, withTiming(d.blocked ? 1 : 0, settle))
          : d.blocked
            ? 1
            : 0;
      const at = sl;
      const animate = () => {
        const sl = at;
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
        } else if (d.laidAt !== undefined && (isNew || slots[sl]?.kind === 'hand')) {
          // A laid card leaves its seat, or your hand where it stood, as its
          // sound plays, and lands where the table counts it (PID-469).
          const { tx, ty, trot, tscale, topacity, laidAt } = d;
          const lay = { duration: LAY_DOWN_FLIGHT_MS, easing: Easing.out(Easing.cubic) };
          const fly = (delay: number) => {
            sx[sl].value = withDelay(delay, withTiming(tx, lay));
            sy[sl].value = withDelay(delay, withTiming(ty, lay));
            srot[sl].value = withDelay(delay, withTiming(trot, lay));
            sscale[sl].value = withDelay(delay, withTiming(tscale, lay));
          };
          // Anyone else's shows as it leaves their seat, as a played card does,
          // and its back goes in the same task (PID-473): a busy phone's JS is
          // late to hear of a face the UI thread put up.
          if (isNew && laidAt > 0) {
            sop[sl].value = 0;
            const leaving = arriving.current.get(sl);
            laidTimers.current.set(
              sl,
              setTimeout(() => {
                laidTimers.current.delete(sl);
                fly(0);
                sop[sl].value = topacity;
                leave(sl, leaving);
              }, laidAt)
            );
          } else {
            fly(laidAt);
            sop[sl].value = topacity;
          }
          flight[sl].value = 1;
        } else if (d.killedAt !== undefined && isNew) {
          // Thrown face up onto its pack spot, turning square as it lands.
          const toss = { duration: SECOND_DEAL_FLIGHT_MS, easing: Easing.out(Easing.cubic) };
          sx[sl].value = withDelay(d.killedAt, withTiming(d.tx, toss));
          sy[sl].value = withDelay(d.killedAt, withTiming(d.ty, toss));
          srot[sl].value = withDelay(d.killedAt, withTiming(d.trot, toss));
          sop[sl].value = d.topacity;
          flight[sl].value = 1;
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
        } else if (settles && move && !collectTo) {
          sx[sl].value = withDelay(settleAt, withTiming(d.tx, settle));
          sy[sl].value = withDelay(settleAt, withTiming(d.ty, settle));
          srot[sl].value = withDelay(settleAt, withTiming(d.trot, settle));
          sscale[sl].value = withDelay(settleAt, withTiming(d.tscale, settle));
        } else if (
          move &&
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
            sy[sl].value -=
              Math.sin(Math.PI * flight[sl].value) * cardH * (slots[sl]?.lift ?? lift);
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
      };
      // A sprite new to its slot moves once the canvas has drawn it (PID-473),
      // and so does every later motion it is given before then, in order.
      const waiting = departures.current.get(sl);
      if (waiting)
        departures.current.set(sl, () => {
          waiting();
          animate();
        });
      else if (isNew) departures.current.set(sl, animate);
      else animate();

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

    for (const d of desired) {
      const sl = keyToSlot.current.get(d.key);
      const caster = d.castBy ? keyToSlot.current.get(d.castBy) : undefined;
      if (sl !== undefined && caster !== undefined && nextSlots[sl] && nextSlots[caster])
        nextSlots[sl]!.caster = caster;
    }

    for (const sl of arriving.current.keys())
      if (!nextSlots[sl] || !desiredKeys.has(nextSlots[sl]!.key)) arriving.current.delete(sl);
    sendArriving(model.seats);
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
    tappedKey.current = key;
    const card = modelRef.current?.yourHand.find((c) => c.key === key)?.card;
    cardTap(() => {
      if (card && onPlayRef.current) onPlayRef.current(card);
      else blockedPlay('stale');
    });
  }, []);

  const blockedTap = useCallback((code: DiagnosticCode, key: string) => {
    tappedKey.current = key;
    blockedCardTap(code);
    onBlockedRef.current?.(code === 'illegal_action' ? 'invalid_action' : code);
  }, []);

  const gesture = useMemo(() => {
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
        const t = cardUnder<HandTarget & { code?: DiagnosticCode }>(
          handTargets.value,
          blockedTargets.value,
          e.x,
          e.y
        );
        if (!t) return;
        if (t.code) {
          blockedPress.value = t.code;
          pressKey.value = t.key;
          return;
        }
        pressSlot.value = t.slot;
        pressKey.value = t.key;
        spress[t.slot].value = 1;
        sy[t.slot].value = withTiming(t.y - t.h * PRESS_LIFT, { duration: PRESS_LIFT_MS });
        sscale[t.slot].value = withTiming(t.scale * 1.06, { duration: PRESS_LIFT_MS });
      })
      .onEnd((_e, success) => {
        'worklet';
        if (success && pressSlot.value >= 0) runOnJS(playByKey)(pressKey.value);
        else if (success && blockedPress.value)
          runOnJS(blockedTap)(blockedPress.value, pressKey.value);
      })
      .onFinalize((_e, success) => {
        'worklet';
        const slot = pressSlot.value;
        if (slot < 0) return;
        pressSlot.value = -1;
        // A played card flies from where it is; if the play never happens
        // (not your turn after all, or the table is still settling), it
        // drops back into the hand. It stays on top until then: by then a
        // played card's own place lies over the pile.
        settle(slot, success ? PRESS_UNPLAYED_MS : 0);
        spress[slot].value = withDelay(
          success ? PRESS_UNPLAYED_MS : 0,
          withTiming(0, { duration: 0 })
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playByKey, blockedTap]);

  // A tap the table did not play: its card shakes side to side and settles (PID-364).
  const shook = useRef(nudge);
  useEffect(() => {
    if (nudge === shook.current) return;
    shook.current = nudge;
    const slot = keyToSlot.current.get(tappedKey.current ?? '');
    const x = [...handTargets.value, ...blockedTargets.value].find((t) => t.slot === slot)?.x;
    if (slot === undefined || x === undefined || reduceMotion) return;
    const d = cardW * SHAKE;
    sx[slot].value = withSequence(
      withTiming(x + d, { duration: 50 }),
      withTiming(x - d, { duration: 80 }),
      withTiming(x + d / 2, { duration: 80 }),
      withTiming(x, { duration: 90 })
    );
    // The pools and targets are stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nudge]);

  // Every card's shadow and gold glow, blurred once per card size.
  useKeptBlurs();
  const lights = useMemo(() => {
    const r = Math.min(10, cardW * 0.12);
    return {
      glow: keptBlur(
        // A soft halo close to the edge, not a slab over the cards beside it (PID-308).
        { x: -cardW / 2 - 2, y: -cardH / 2 - 2, width: cardW + 4, height: cardH + 4, r: r + 2 },
        8,
        T.gold
      ),
      shadow: keptBlur(
        { x: -cardW / 2 + 1, y: -cardH / 2 + 4, width: cardW, height: cardH, r },
        5,
        CARD_SHADOW
      ),
      // Where the suit changes (PID-461): softer, cast a little left of the card's face.
      suit: keptBlur(
        {
          x: -cardW / 2 + cardW * FACE_INSET - 3 * SUIT_REACH,
          y: -cardH / 2 + 2,
          width: cardW * (1 - 2 * FACE_INSET),
          height: cardH - 4,
          r: cardW * FACE_CORNER,
        },
        9 * SUIT_REACH,
        SUIT_SHADOW_COLOR
      ),
    };
  }, [cardW, cardH]);

  const nodes = useMemo(() => {
    // Each face's art and sampling, from where it rests at its largest (PID-467).
    const px = PixelRatio.get();
    const art = [cardW * L.trick.pileScale, cardW * handScale].map((w) =>
      largeFaceSampling(!!textures?.large, w * px)
    );
    const ordered = slots
      .map((s, i) => ({ s, i }))
      .filter((x): x is { s: NonNullable<SlotInfo>; i: number } => x.s !== null)
      .sort((a, b) => a.s.z - b.s.z);
    return (
      // One group, so a pressed card's zIndex lifts it over its neighbours: Skia orders by zIndex only within a group.
      <Group>
        {ordered.map(({ s, i }) => (
          <CardSprite
            key={`${i}:${s.born}`}
            // Today's face until the larger one decodes, or if it failed to.
            img={
              (art[+s.yours] && textures?.get(s.textureKey, true)) ||
              (textures?.get(s.textureKey) ?? null)
            }
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
            shade={sshade[i]}
            winner={s.winner}
            winnerReveal={winnerReveal}
            leading={s.leading}
            leadGlow={leadGlow}
            flashing={s.flashing}
            flashGlow={flashGlow}
            previewed={s.previewed}
            lights={lights}
            cast={
              s.caster !== undefined
                ? {
                    id: `${s.caster}:${slots[s.caster]?.born}`,
                    x: sx[s.caster],
                    y: sy[s.caster],
                    scale: sscale[s.caster],
                    rot: srot[s.caster],
                  }
                : undefined
            }
            pressed={spress[i]}
            z={sz[i]}
            onDrawn={() => depart(i, s.born)}
            sampling={
              art[+s.yours] ?? (L.profile.startsWith('tablet') ? TABLET_SAMPLING : undefined)
            }
          />
        ))}
      </Group>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, textures, cardW, cardH, handScale, L, lights]);

  const renderedPlayedCardCount = slots.reduce(
    (count, slot) => count + (slot?.kind === 'played' && !slot.key.startsWith('killed-') ? 1 : 0),
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
                slot: i,
                born: slot.born,
                key: slot.key,
                kind: slot.kind,
                z: slot.z,
                // Skia's order: the pressed card on top, then by each card's place.
                drawZ: spress[i].value * 1000 + sz[i].value,
                pressed: pressSlot.value === i,
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
                // Drawn by the canvas: until then it shows nothing (PID-473).
                shown: shownBirths.current.get(i) === slot.born,
                shade: slot.blocked ? sshade[i].value : 0,
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
  shade,
  winner,
  winnerReveal,
  leading,
  leadGlow,
  flashing,
  flashGlow,
  previewed,
  lights,
  cast,
  pressed,
  z,
  onDrawn,
  sampling,
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
  shade: SharedValue<number>;
  winner: boolean;
  winnerReveal: SharedValue<number>;
  leading: boolean;
  leadGlow: SharedValue<number>;
  flashing: boolean;
  flashGlow: SharedValue<number>;
  previewed: boolean;
  lights: { glow: BakedBlur | null; shadow: BakedBlur | null; suit: BakedBlur | null };
  /** The next card, where it starts another suit: its shadow deepens on this one. */
  cast?: Cast;
  pressed: SharedValue<number>;
  z: SharedValue<number>;
  /** Called once, a frame after the canvas first draws this sprite. */
  onDrawn: () => void;
  sampling?: { B: number; C: number };
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
          (winner ? 1 + winnerReveal.value * 0.05 : leading ? 1 + leadGlow.value * 0.02 : 1),
      },
    ];
  });
  // Nothing of a new sprite shows before the canvas has drawn it once: its
  // first frames hold whatever its slot last showed (PID-473).
  const shown = useSharedValue(0);
  const visible = useDerivedValue(() => opacity.value * (1 - sweep.value) * shown.value);
  // Over every card while pressed, the next one casting nothing on it then.
  // Otherwise each card lies at its place, in the frame its motion starts.
  const zIndex = useDerivedValue(() => z.value + 1000 * pressed.value);
  const castOpacity = useDerivedValue(() => Math.min(1, SUIT_SHADOW) * (1 - pressed.value));
  const winnerOpacity = useDerivedValue(() =>
    Math.max(
      winner ? winnerReveal.value : leading ? leadGlow.value * 0.85 : 0,
      flashing ? flashGlow.value : 0
    )
  );
  // After the mappers above start, and after the canvas records this sprite:
  // it shows where it is given, and its motion starts there.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      shown.value = 1;
      onDrawn();
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the sprite mounts
  }, []);
  const r = Math.min(10, w * 0.12);
  // Only these cards ever glow; for the rest the glow is never drawn at all.
  const glows = winner || leading || flashing;
  return (
    <Group transform={transform} opacity={visible} zIndex={zIndex}>
      {glows && lights.glow && <Baked blur={lights.glow} opacity={winnerOpacity} />}
      {/* Soft drop shadow grounds the card on the felt. */}
      {lights.shadow && <Baked blur={lights.shadow} />}
      {img ? (
        <Image
          image={img}
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          fit="cover"
          sampling={sampling}
        />
      ) : (
        <RoundedRect x={-w / 2} y={-h / 2} width={w} height={h} r={r} color={T.cardFrame} />
      )}
      {/* The next suit's first card shades this card's face, and nothing past it. */}
      {cast && lights.suit && (
        <Group
          clip={rrect(
            rect(
              -w / 2 + w * FACE_INSET,
              -h / 2 + h * FACE_INSET_Y,
              w * (1 - 2 * FACE_INSET),
              h * (1 - 2 * FACE_INSET_Y)
            ),
            w * FACE_CORNER,
            w * FACE_CORNER
          )}>
          <SuitShade
            // A new caster is a new shade: right from its first frame (PID-473).
            key={cast.id}
            cast={cast}
            card={{ x, y, rot, scale }}
            opacity={castOpacity}
            blur={lights.suit}
          />
        </Group>
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
          opacity={shade}
        />
      )}
      {/* A fine gold rim on the card's own edge, never past it. */}
      {glows && (
        <RoundedRect
          x={-w / 2 + 0.75}
          y={-h / 2 + 0.75}
          width={w - 1.5}
          height={h - 1.5}
          r={Math.max(0, r - 0.75)}
          color={T.goldLight}
          style="stroke"
          strokeWidth={1.5}
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
/**
 * How strong the shadow is where your hand's suit changes (PID-461), one
 * number to tune: up to 1 its opacity on the card it falls on; past 1, at
 * full opacity, it reaches that much further and softer onto the card.
 */
const SUIT_SHADOW = 1.2;
const SUIT_REACH = Math.max(1, SUIT_SHADOW);
const SUIT_SHADOW_COLOR = 'rgb(2, 14, 28)';
/** The card art's face inside its image: an inset on each side and its corner, as shares of the width (and height). */
const FACE_INSET = 16 / 336;
const FACE_INSET_Y = 16 / 466;
const FACE_CORNER = 22 / 336;
/**
 * Tablets that draw today's 168px art (PID-453) keep a Catmull-Rom cubic,
 * crisper than Skia's bilinear default; phones keep that default. The larger
 * art picks its own (`largeFaceSampling`).
 */
const TABLET_SAMPLING = { B: 0, C: 0.5 };

type Pose = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  scale: SharedValue<number>;
  rot: SharedValue<number>;
};
type Cast = Pose & { id: string };

function SuitShade({
  cast,
  card,
  opacity,
  blur,
}: {
  cast: Pose;
  card: Pose;
  opacity: SharedValue<number>;
  blur: BakedBlur;
}) {
  // The next card's place, turn and size as this card sees them, every frame.
  const castAt = useDerivedValue(() => {
    const dx = cast.x.value - card.x.value;
    const dy = cast.y.value - card.y.value;
    const cos = Math.cos(card.rot.value);
    const sin = Math.sin(card.rot.value);
    return [
      { translateX: (dx * cos + dy * sin) / card.scale.value },
      { translateY: (dy * cos - dx * sin) / card.scale.value },
      { rotate: cast.rot.value - card.rot.value },
      { scale: cast.scale.value / card.scale.value },
    ];
  });
  return (
    <Group transform={castAt} opacity={opacity}>
      <Baked blur={blur} />
    </Group>
  );
}

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
