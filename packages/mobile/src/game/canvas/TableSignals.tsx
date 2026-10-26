/**
 * What just happened at the table, in the server's words: a "+N" where a
 * trick was taken, in the colour of the team that took it (a trick holding a
 * five is a "Pidro!"). The server decides who wins and what anything is worth;
 * this only shows it. Only what matters gets fanfare: a trick worth nothing
 * passes quietly. How a hand scored is `HandResult`.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PidroText } from '@/components/ui/PidroText';
import { PidroBevel, PidroColors, PidroRadii, PidroSpacing } from '@/design/tokens';
import { PIDRO_POINTS, whosePoints, type PointsSide } from '@/features/game/points';
import {
  playBigTrickHaptic,
  playOurPidroHaptic,
  playTheirPidroHaptic,
} from '@/game/useGameHaptics';
import type { RelativePosition } from '@/types/game';
import { isStillCapture } from '@/utils/stillCapture';
import { computeLayout, playedCardTarget, type TableLayout } from './layout';
import type { TableModel, TrickResult } from './tableModel';
import type { ScoreGlow } from './Scoreboard';
import { useTranslation } from '@/i18n';

const POP_MS = 1500;
const easeOutCubic = (t: number) => {
  'worklet';
  return 1 - Math.pow(1 - t, 3);
};

type Props = {
  model: TableModel;
  topReserve?: number;
  bottomReserve?: number;
};

export function TableSignals({ model, topReserve = 0, bottomReserve = 0 }: Props) {
  const { width, height } = useWindowDimensions();
  const { top, bottom, left, right } = useSafeAreaInsets();
  const L = useMemo(
    () => computeLayout(width, height, { top, bottom, left, right }, topReserve, bottomReserve),
    [width, height, top, bottom, left, right, topReserve, bottomReserve]
  );
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <TrickPop trick={model.lastTrick} seats={model.seats} L={L} popMs={POP_MS} />
    </View>
  );
}

/** Points a trick scored for one seat: whose they were and where they land. */
export type TrickScore = {
  side: PointsSide;
  column: 'us' | 'them';
  seat: RelativePosition;
  points: number;
};

/**
 * Who scored what in a trick: its taker, and the 2 of trump's holder, whose
 * point stays with the team that played it.
 */
export function trickScores(
  trick: TrickResult | null,
  seats: TableModel['seats']
): { taken: TrickScore | null; two: TrickScore | null } {
  const viewer = Object.values(seats).find((seat) => seat?.isYou)?.absolutePosition ?? null;
  const score = (rel: RelativePosition, points: number): TrickScore | null => {
    const scorer = seats[rel];
    return scorer && points > 0
      ? { ...whosePoints(scorer.absolutePosition, viewer), seat: rel, points }
      : null;
  };
  return {
    taken: trick ? score(trick.winner, trick.points) : null,
    two: trick?.twoOfTrump ? score(trick.twoOfTrump.holder, trick.twoOfTrump.points) : null,
  };
}

/** The trick's taker, when the trick held a five. */
export function tablePidro(
  trick: TrickResult | null,
  seats: TableModel['seats']
): TrickScore | null {
  const { taken } = trickScores(trick, seats);
  return taken && taken.points >= PIDRO_POINTS ? taken : null;
}

/** The score columns the last trick's points landed in, lit under `key`. */
export function scoreGlow(
  trick: TrickResult | null,
  seats: TableModel['seats'],
  key: string
): ScoreGlow | null {
  const { taken, two } = trickScores(trick, seats);
  if (!taken && !two) return null;
  const columns: ScoreGlow['columns'] = {};
  for (const score of [taken, two]) if (score) columns[score.column] = score.side;
  return { columns, key };
}

/**
 * "+N" rising where the trick was taken; "Pidro!" when it held a five. The 2
 * of trump's point rises where it was played, since it stays with that team.
 * Plays only for a trick taken while watching, never for one already done.
 */
function TrickPop({
  trick,
  seats,
  L,
  popMs,
}: {
  trick: TrickResult | null;
  seats: TableModel['seats'];
  L: TableLayout;
  popMs: number;
}) {
  const { t } = useTranslation();
  // A trick taken while watching pops; one already done when the table opened does not.
  const number = trick?.number ?? null;
  const [seen, setSeen] = useState(number);
  const [pop, setPop] = useState<TrickResult | null>(null);
  if (number !== seen) {
    setSeen(number);
    // No finished trick yet counts as zero, so a hand's first trick pops too.
    const taken = number != null && number > (seen ?? 0) ? trick : null;
    setPop(taken && (taken.points > 0 || taken.twoOfTrump) ? taken : null);
  }

  const { taken, two } = trickScores(pop, seats);
  const pidro = tablePidro(pop, seats);
  const side = pidro?.side ?? null;
  useEffect(() => {
    if (side === 'ours') playOurPidroHaptic();
    else if (side === 'theirs') playTheirPidroHaptic();
    else if (side === 'neutral') playBigTrickHaptic();
  }, [pop, side]);

  if (!pop) return null;
  // A small "+N" sits on the table side of the card it rose from, clear of
  // the seat's name; a "Pidro!" takes the middle, where nothing competes.
  const above = (rel: TrickResult['winner']) => {
    const card = playedCardTarget(L, rel, 0, 1);
    const dx = L.trick.cx - card.x;
    const dy = L.trick.cy - card.y;
    const toward = (L.cardH * 0.42) / Math.max(1, Math.hypot(dx, dy));
    return { x: card.x + dx * toward, y: card.y + dy * toward };
  };
  const big = pidro != null;
  // Who got the points, so a five never reads as ours when it was theirs.
  const team = !pidro
    ? ''
    : pidro.side === 'neutral'
      ? t(pidro.column === 'us' ? 'game.ns_short' : 'game.ew_short')
      : t(pidro.side === 'ours' ? 'game.us' : 'game.them');
  const taker = pidro?.side === 'theirs' ? seats[pidro.seat]?.username : null;
  const at = big ? { x: L.trick.cx, y: L.trick.cy } : above(pop.winner);
  const twoAt = pop.twoOfTrump ? above(pop.twoOfTrump.holder) : null;
  return (
    <>
      {taken ? (
        <Pop
          key={`win-${pop.number}`}
          x={at.x}
          y={at.y}
          label={`+${taken.points}`}
          side={taken.side}
          pidro={
            pidro
              ? {
                  chip: `${team} +${pop.points}${taker ? ` · ${taker}` : ''}`,
                }
              : null
          }
          ms={popMs}
        />
      ) : null}
      {twoAt && two ? (
        <Pop
          key={`two-${pop.number}`}
          x={twoAt.x}
          y={twoAt.y + (!big && two.seat === pop.winner ? -26 : 0)}
          label={`+${two.points}`}
          side={two.side}
          ms={popMs}
        />
      ) : null}
    </>
  );
}

/**
 * Whose points they were, in their team's colour: a "+N" and the chip under a
 * "Pidro!". Our "Pidro!" itself stays gold: that is good news, not a team.
 */
const POINTS_TONE = {
  ours: {
    text: PidroColors.teamUs,
    border: PidroColors.teamUs,
    glow: PidroColors.teamUsSoft,
    edge: PidroColors.teamUsSoft,
  },
  theirs: {
    text: PidroColors.teamThem,
    border: PidroColors.teamThem,
    glow: PidroColors.teamThemSoft,
    edge: PidroColors.teamThemSoft,
  },
  neutral: {
    text: PidroColors.cyanText,
    border: PidroColors.cyanBorderStrong,
    glow: PidroColors.cyanSoft,
    edge: PidroColors.cyanSoft,
  },
} as const;

function Pop({
  x,
  y,
  label,
  side,
  pidro = null,
  ms,
}: {
  x: number;
  y: number;
  label: string;
  side: PointsSide;
  /** A trick holding a five: "Pidro!" in the middle, and whose points it was. */
  pidro?: { chip: string } | null;
  ms: number;
}) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  const big = pidro != null;
  // Their Pidro is the same moment, a size down: it is not ours to celebrate.
  const size = pidro && side === 'theirs' ? 0.88 : 1;
  useEffect(() => {
    // UI grammar captures the pop at its peak instead of mid-flight.
    t.value = isStillCapture() ? 0.35 : withTiming(1, { duration: ms, easing: Easing.linear });
  }, [t, ms]);
  const motion = useAnimatedStyle(() => {
    // Reduced motion: no rise, no swell, no fade; it is there, then gone.
    if (reduceMotion) return { opacity: t.value < 1 ? 1 : 0, transform: [{ scale: size }] };
    const appear = Math.min(1, t.value / 0.12);
    const fade = t.value < 0.7 ? 1 : Math.max(0, 1 - (t.value - 0.7) / 0.3);
    const rise = -(big ? 24 : 18) * easeOutCubic(t.value);
    // A quick swell past full size, then settle: the "pop".
    const swell = appear < 1 ? 0.8 + 0.3 * appear : 1.1 - 0.1 * Math.min(1, (t.value - 0.12) / 0.1);
    return {
      opacity: appear * fade,
      transform: [{ translateY: rise }, { scale: size * swell }],
    };
  });
  const box = big ? 280 : 64;
  const height = big ? 44 : 28;
  const tone = POINTS_TONE[side];
  if (!pidro) {
    return (
      <Animated.View
        pointerEvents="none"
        testID={`trick-pop-${side}`}
        style={[styles.pop, { left: x - box / 2, top: y - height / 2, width: box }, motion]}>
        <View style={[styles.popChip, { borderColor: tone.edge }]}>
          <PidroText role="label" style={[styles.popText, { color: tone.text }]}>
            {label}
          </PidroText>
        </View>
      </Animated.View>
    );
  }
  return (
    <Animated.View
      pointerEvents="none"
      testID={`trick-pop-pidro-${side}`}
      style={[styles.pop, { left: x - box / 2, top: y - height / 2, width: box }, motion]}>
      <View
        style={[
          styles.popChip,
          styles.popChipBig,
          { borderColor: tone.border, boxShadow: `0px 0px 18px ${tone.glow}` },
        ]}>
        <PidroText
          role="title"
          style={[styles.popText, side === 'ours' ? styles.pidro : { color: tone.text }]}>
          Pidro!
        </PidroText>
      </View>
      <View style={[styles.popChip, styles.whoseChip, { borderColor: tone.border }]}>
        <PidroText role="label" numberOfLines={1} style={[styles.popText, { color: tone.text }]}>
          {pidro.chip}
        </PidroText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  onTable: {
    position: 'absolute',
    alignItems: 'center',
  },
  onTablePill: {
    paddingHorizontal: PidroSpacing.sm,
    paddingVertical: 2,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroColors.trickChipBg,
    borderWidth: 1,
    borderColor: PidroColors.goldSoft,
  },
  onTableText: {
    fontWeight: '800',
  },
  pop: {
    position: 'absolute',
    alignItems: 'center',
  },
  popChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.xs,
    paddingHorizontal: PidroSpacing.sm,
    paddingVertical: 2,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroColors.trickChipBg,
    borderWidth: 1,
    borderColor: PidroColors.goldSoft,
  },
  popChipBig: {
    paddingHorizontal: PidroSpacing.md,
    paddingVertical: PidroSpacing.xxs,
    borderWidth: 2,
  },
  whoseChip: {
    marginTop: PidroSpacing.xxs,
    maxWidth: '100%',
  },
  popText: {
    fontWeight: '900',
    textShadowColor: PidroColors.popShadow,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  pidro: {
    color: PidroBevel.textGold,
  },
});
