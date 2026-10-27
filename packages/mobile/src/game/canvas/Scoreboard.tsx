/**
 * Mounted navy-and-brass score plaque. Tap for the server's full hand history.
 * Its labels are the key to the names at the table: US (N/S for a spectator)
 * in our team's colour, THEM (E/W) in theirs.
 * Under it in portrait, beside it in landscape where the West seat sits below,
 * the action ticker: the latest table actions, resting on who holds the bid as
 * Classic's "Bet 6" did. Tap the ticker for the hand's log. With count help
 * (PID-220), the "Last trick" pill sits under it, and small phones that leave
 * the ticker out keep its resting line. Points a trick scores glow the column
 * they landed in (PID-230).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { gradientBg } from '@/components/ui/Bevel';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { PidroBevel, PidroColors, PidroFonts, PidroRadii, PidroSpacing } from '@/design/tokens';
import type { Position } from '@/types/lobby';
import type { PointsSide } from '@/features/game/points';
import { isStillCapture } from '@/utils/stillCapture';
import type { ServerHandSummary } from '@pidro/shared';
import { HandHistory } from '@/components/game/HandHistory';
import { handLogEntries, type HandLogEntry, type HandLogGroup } from '@/game/handLog';
import { ActionTicker, type TickerRestingLine } from './ActionTicker';
import { SCORE_COUNT } from './HandResult';
import { HandLogWindow } from './HandLogWindow';
import { BoxShadow } from './bakedBlur';
import { formatNumber, useTranslation } from '@/i18n';

type Scores = { north_south: number; east_west: number } | null | undefined;
type ConcreteScores = { north_south: number; east_west: number };

// The plaque's fonts are capped, so its height is fixed: rim, padding, label, figure.
const RIM = 1.5;
const LABEL_LINE = 13;
const VALUE_LINE = 29;
export const SCORE_PLAQUE_HEIGHT = 2 * RIM + 2 * PidroSpacing.xxs + LABEL_LINE + VALUE_LINE;

const NO_ENTRIES: HandLogEntry[] = [];

/** Points landing on the score: up quickly, held a moment, then gone. */
const GLOW_IN_MS = 180;
const GLOW_HOLD_MS = 1100;
const GLOW_OUT_MS = 700;
const GLOW_TINT = {
  ours: PidroColors.teamUsSoft,
  theirs: PidroColors.teamThemSoft,
  neutral: PidroColors.cyanSoft,
} as const;
const GLOW_EDGE = {
  ours: PidroColors.teamUs,
  theirs: PidroColors.teamThem,
  neutral: PidroColors.cyanBorderStrong,
} as const;

/** The columns a trick's points landed in, and whose they were; lit once per `key`. */
export type ScoreGlow = { columns: Partial<Record<'us' | 'them', PointsSide>>; key: string };

/** Lights once for each new key; a table that opens on scored points stays dark. */
function useScoreGlow(key: string | null) {
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  const seen = useRef(key);
  useEffect(() => {
    if (!key || key === seen.current) return;
    seen.current = key;
    // UI grammar captures the glow lit.
    if (isStillCapture()) {
      t.set(1);
      return;
    }
    const fade = (to: number, ms: number) =>
      withTiming(to, { duration: reduceMotion ? 0 : ms, easing: Easing.out(Easing.quad) });
    t.set(withSequence(fade(1, GLOW_IN_MS), withDelay(GLOW_HOLD_MS, fade(0, GLOW_OUT_MS))));
  }, [key, reduceMotion, t]);
  useEffect(() => () => cancelAnimation(t), [t]);
  return useAnimatedStyle(() => ({ opacity: t.value }));
}

/**
 * What a team's score just moved by, beside its figure while a hand's result
 * shows (PID-236), counting up as the point cards land.
 */
function ScoreDelta({ value, side }: { value: number; side: PointsSide }) {
  const reduceMotion = useReducedMotion();
  const instant = reduceMotion || isStillCapture();
  const [shown, setShown] = useState<number | null>(instant ? value : null);
  useEffect(() => {
    if (instant) return;
    const start = Date.now() + SCORE_COUNT.delayMs;
    const id = setInterval(() => {
      const progress = (Date.now() - start) / SCORE_COUNT.ms;
      if (progress < 0) return;
      setShown(Math.round(value * Math.min(1, progress)));
      if (progress >= 1) clearInterval(id);
    }, 40);
    return () => clearInterval(id);
  }, [instant, value]);
  if (shown == null || value === 0) return null;
  const tone = value < 0 ? 'down' : side;
  return (
    <View testID={`score-delta-${side}`} style={[styles.delta, DELTA_TONE[tone].face]}>
      <PidroText
        role="metadata"
        style={[styles.deltaText, { color: DELTA_TONE[tone].ink }]}
        maxFontSizeMultiplier={1}>
        {`${value < 0 ? '−' : '+'}${formatNumber(Math.abs(shown))}`}
      </PidroText>
    </View>
  );
}

const DELTA_TONE = {
  ours: { face: { backgroundColor: PidroColors.teamUs }, ink: PidroColors.ink },
  theirs: { face: { backgroundColor: PidroColors.teamThem }, ink: PidroColors.teamThemInk },
  neutral: {
    face: {
      backgroundColor: PidroColors.trickChipBg,
      borderWidth: 1,
      borderColor: PidroColors.cyanBorderStrong,
    },
    ink: PidroColors.text,
  },
  down: {
    face: {
      backgroundColor: PidroColors.scoreDownBg,
      borderWidth: 1,
      borderColor: PidroColors.scoreDownEdge,
    },
    ink: PidroColors.theirScore,
  },
} as const;

function teams(scores: Scores, you: Position | null) {
  const ns = scores?.north_south ?? 0;
  const ew = scores?.east_west ?? 0;
  const youAreNS = you === null || you === 'north' || you === 'south';
  return { us: youAreNS ? ns : ew, them: youAreNS ? ew : ns };
}

export function Scoreboard({
  scores,
  youPosition,
  history,
  roomCode = null,
  top = 0,
  left = 0,
  log = [],
  resting = null,
  ticker,
  stateArrived = true,
  restingOnly = false,
  help = null,
  glow = null,
  delta = null,
}: {
  scores: Scores;
  youPosition: Position | null;
  history?: readonly ServerHandSummary[];
  roomCode?: string | null;
  top?: number;
  left?: number;
  /** The hand log behind the ticker. */
  log?: HandLogGroup[];
  resting?: TickerRestingLine | null;
  /** Kept for fixture callers; a turn change never dismisses the log. */
  yourTurn?: boolean;
  /** Where the ticker keeps off North's fan (layout's tickerPlacement); null leaves it out. */
  ticker?: { lineMaxWidth: number; drop: number } | null;
  /** False until the table has its first server state; the ticker waits for it. */
  stateArrived?: boolean;
  /** Only the resting line, where the table has no room for the passing ones. */
  restingOnly?: boolean;
  /** Under the ticker: the count help's "Last trick". */
  help?: ReactNode;
  /** The columns a trick's points just landed in. */
  glow?: ScoreGlow | null;
  /** What the hand just scored moved each team's score by (`delta` of `last_hand`). */
  delta?: ConcreteScores | null;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const { us, them } = teams(scores, youPosition);
  const moved = delta ? teams(delta, youPosition) : null;
  const usSide: PointsSide = youPosition ? 'ours' : 'neutral';
  const themSide: PointsSide = youPosition ? 'theirs' : 'neutral';
  const usLabel = youPosition ? t('game.us').toLocaleUpperCase() : t('game.ns_short');
  const themLabel = youPosition ? t('game.them').toLocaleUpperCase() : t('game.ew_short');
  const glowStyle = useScoreGlow(glow?.key ?? null);
  const glowLight = (column: 'us' | 'them') => {
    const side = glow?.columns[column];
    return side ? (
      <Animated.View
        pointerEvents="none"
        testID={`score-glow-${column}`}
        style={[styles.glow, { backgroundColor: GLOW_TINT[side] }, glowStyle]}>
        <BoxShadow shadow={`0px 0px 10px ${GLOW_EDGE[side]}`} radius={PidroRadii.tight} />
      </Animated.View>
    ) : null;
  };
  const [isOpen, setIsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const entries = useMemo(() => handLogEntries(log), [log]);
  const prevRoomRef = useRef<string | null>(roomCode);

  useEffect(() => {
    if (prevRoomRef.current === roomCode) return;
    prevRoomRef.current = roomCode;
    setIsOpen(false);
    setLogOpen(false);
  }, [roomCode]);

  return (
    <View
      style={[
        styles.wrap,
        landscape ? styles.wrapRow : null,
        { top, left: left + PidroSpacing.sm },
      ]}
      pointerEvents="box-none">
      <PressableFX
        accessibilityRole="button"
        accessibilityLabel={t('game.score_accessibility', { usLabel, us, themLabel, them })}
        accessibilityState={{ expanded: isOpen }}
        onPress={() => setIsOpen((open) => !open)}
        style={[styles.plaque, gradientBg(PidroBevel.goldRimGradient)]}>
        <View style={styles.plaqueRow}>
          <View style={styles.col}>
            {glowLight('us')}
            <PidroText
              role="metadata"
              style={[styles.label, { color: PidroColors.teamUs }]}
              maxFontSizeMultiplier={1}>
              {usLabel}
            </PidroText>
            <PidroText role="title" style={styles.value} maxFontSizeMultiplier={1}>
              {formatNumber(us)}
            </PidroText>
          </View>
          {moved ? <ScoreDelta value={moved.us} side={usSide} /> : null}
          <View style={styles.divider} />
          <View style={styles.col}>
            {glowLight('them')}
            <PidroText
              role="metadata"
              style={[styles.label, { color: PidroColors.teamThem }]}
              maxFontSizeMultiplier={1}>
              {themLabel}
            </PidroText>
            <PidroText role="title" style={styles.value} maxFontSizeMultiplier={1}>
              {formatNumber(them)}
            </PidroText>
          </View>
          {moved ? <ScoreDelta value={moved.them} side={themSide} /> : null}
          <Icon name="chevron-down" size={14} color={PidroColors.goldLight} />
        </View>
      </PressableFX>
      {/* A new table starts its ticker afresh. */}
      {ticker !== null ? (
        <View style={{ marginTop: ticker?.drop ?? 0 }} pointerEvents="box-none">
          <ActionTicker
            key={roomCode ?? 'table'}
            entries={restingOnly ? NO_ENTRIES : entries}
            resting={resting}
            onOpenLog={() => setLogOpen(true)}
            stateArrived={stateArrived}
            lineMaxWidth={ticker?.lineMaxWidth}
          />
          {help}
        </View>
      ) : null}
      {/* Closed, the log builds nothing. */}
      <HandLogWindow open={logOpen} onClose={() => setLogOpen(false)} groups={logOpen ? log : []} />

      {isOpen ? (
        <HandHistory history={history} viewer={youPosition} onClose={() => setIsOpen(false)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', zIndex: 44, alignItems: 'flex-start', gap: PidroSpacing.xxs },
  // Top-aligned, so a growing ticker never moves the plaque.
  wrapRow: { flexDirection: 'row', alignItems: 'flex-start', gap: PidroSpacing.sm },
  plaque: {
    padding: RIM,
    borderRadius: PidroRadii.lg,
    boxShadow: PidroBevel.glassDropShadow,
  },
  plaqueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.xs,
    paddingHorizontal: PidroSpacing.sm,
    paddingVertical: PidroSpacing.xxs,
    backgroundColor: PidroBevel.panelDeep,
    borderRadius: PidroRadii.lg - RIM,
    boxShadow: PidroBevel.glassFaceInset,
  },
  col: { alignItems: 'center', minWidth: 52 },
  glow: {
    ...StyleSheet.absoluteFill,
    borderRadius: PidroRadii.tight,
  },
  label: {
    fontSize: 10,
    lineHeight: LABEL_LINE,
  },
  value: {
    color: PidroColors.text,
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 22,
    lineHeight: VALUE_LINE,
  },
  delta: {
    height: 20,
    paddingHorizontal: 6,
    marginLeft: -PidroSpacing.xxs,
    borderRadius: PidroRadii.full,
    justifyContent: 'center',
  },
  deltaText: { fontWeight: '900', fontSize: 12, lineHeight: 16, letterSpacing: 0 },
  divider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: PidroColors.goldSoft,
    marginVertical: 2,
  },
});
