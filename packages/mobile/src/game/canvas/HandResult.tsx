/**
 * The end of a hand (PID-236): the table dims, and one panel says how the bid
 * went and shows the point cards each team took, flying in from the trick. It
 * closes by itself in Quick; own pace waits for the server's Continue gate.
 * While it is open the seats fade back, the score
 * header shows what each team's score moved by, and the next hand's bidding
 * waits. The server says what every card was worth and who kept it.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VictoryConfetti, VictoryRays } from '@/components/game/VictoryConfetti';
import { TextLink } from '@/components/ui/TextLink';
import { actionTap, pushAttempt } from '@/diagnostics/actions';
import { PidroText } from '@/components/ui/PidroText';
import { PidroBevel, PidroColors, PidroFonts, PidroRadii, PidroSpacing } from '@/design/tokens';
import {
  celebratesAll14,
  handResultView,
  type HandResultTray,
  type HandResultView,
} from '@/features/game/handResult';
import { PIDRO_POINTS, type PointsSide } from '@/features/game/points';
import type { Card, ServerLastHand } from '@/types/game';
import type { Position } from '@/types/lobby';
import { getCardImage } from '@/utils/cardImages';
import { SUIT_SYMBOLS } from '@/utils/cards';
import { isStillCapture } from '@/utils/stillCapture';
import { playOurPidroHaptic } from '@/game/useGameHaptics';
import { formatNumber, useTranslation } from '@/i18n';
import { TABLE_HEADER, headerTop } from './TableChrome';
import { computeLayout } from './layout';
import type { TableModel } from './tableModel';

/** The cards fly in one after another; the score header counts while they land. */
const CARDS_FROM_MS = 300;
const CARD_STAGGER_MS = 60;
const CARD_FLY_MS = 460;
export const SCORE_COUNT = { delayMs: CARDS_FROM_MS + CARD_FLY_MS, ms: 400 };
const STAMP_DELAY_MS = 700;
const CARD_W = 44;
const CARD_RATIO = 110 / 78;
const EASE_OUT = Easing.bezier(0.2, 0.9, 0.3, 1);

/** The viewer's seat; null for a spectator. */
export const viewerOf = (seats: TableModel['seats']): Position | null =>
  Object.values(seats).find((seat) => seat?.isYou)?.absolutePosition ?? null;

export type HandResultState = {
  view: HandResultView;
  hand: ServerLastHand;
  /** Quick's reading time; own pace has no deadline. */
  closeMs: number;
  waiting: boolean;
};

/**
 * The result of a hand scored while watching: `hand` is undefined until the
 * table has its first state, so a result already there when it opens stays shut.
 */
export function useHandResult(
  hand: ServerLastHand | null | undefined,
  viewer: Position | null,
  room: string,
  waiting = false
): { result: HandResultState | null; opening: boolean; close: () => void } {
  const handNumber = hand === undefined ? undefined : (hand?.hand_number ?? null);
  const [seen, setSeen] = useState(handNumber);
  const [shown, setShown] = useState<number | null>(null);
  const [wasWaiting, setWasWaiting] = useState(waiting);
  if (waiting !== wasWaiting) {
    setWasWaiting(waiting);
    if (!waiting) setShown(null);
  }
  // A result about to open: true on the very render its hand arrives, before
  // `shown` catches up, so whatever holds for it holds from the start.
  const opening = waiting || (handNumber !== seen && seen !== undefined && handNumber != null);
  if (handNumber !== seen) {
    setSeen(handNumber);
    if (seen !== undefined && handNumber != null) setShown(handNumber);
  }
  const result = useMemo(() => {
    if (!hand || (!waiting && shown !== hand.hand_number)) return null;
    const view = handResultView(hand, viewer, room);
    return { view, hand, closeMs: view.closeMs, waiting };
  }, [hand, shown, viewer, waiting, room]);
  const closeMs = result?.closeMs ?? null;
  useEffect(() => {
    if (waiting || closeMs == null || isStillCapture()) return;
    const timer = setTimeout(() => setShown(null), closeMs);
    return () => clearTimeout(timer);
  }, [shown, closeMs, waiting]);
  return { result, opening, close: () => setShown(null) };
}

type Tone = { label: string; figure: string; tray: string; edge: string };
const TONES: Record<PointsSide, Tone> = {
  ours: {
    label: PidroColors.teamUs,
    figure: PidroBevel.textGold,
    tray: PidroColors.trayOurs,
    edge: PidroColors.teamUs,
  },
  theirs: {
    label: PidroColors.teamThem,
    figure: PidroColors.theirScore,
    tray: PidroColors.trayTheirs,
    edge: PidroColors.trayTheirsEdge,
  },
  neutral: {
    label: PidroColors.cyanText,
    figure: PidroColors.text,
    tray: PidroColors.trayOurs,
    edge: PidroColors.borderStrong,
  },
};

const RED = new Set(['hearts', 'diamonds']);

export function HandResultPanel({
  result,
  seats,
  onClose,
  onContinue,
  topReserve = 0,
  bottomReserve = 0,
}: {
  result: HandResultState;
  seats: TableModel['seats'];
  onClose: () => void;
  onContinue?: () => Promise<boolean> | boolean;
  topReserve?: number;
  bottomReserve?: number;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const L = useMemo(
    () => computeLayout(width, height, insets, topReserve, bottomReserve),
    [width, height, insets, topReserve, bottomReserve]
  );
  const { view, closeMs, waiting } = result;
  const [pending, setPending] = useState(false);
  const continuing = useRef(false);
  const still = reduceMotion || isStillCapture();
  const celebrate = celebratesAll14(result.hand, viewerOf(seats));
  useEffect(() => {
    if (!celebrate || isStillCapture()) return;
    const timer = setTimeout(playOurPidroHaptic, still ? 0 : STAMP_DELAY_MS + 420);
    return () => clearTimeout(timer);
  }, [celebrate, still]);

  const continueHand = () =>
    actionTap('continue_hand', async () => {
      if (!onContinue || continuing.current) {
        pushAttempt('continue_hand').record('blocked', 'pending');
        return;
      }
      continuing.current = true;
      setPending(true);
      let accepted = false;
      try {
        accepted = await onContinue();
      } finally {
        // An acknowledgement can precede the state broadcast that removes us.
        if (!accepted) {
          continuing.current = false;
          setPending(false);
        }
      }
    });

  const name = (position: Position) =>
    Object.values(seats).find((seat) => seat?.absolutePosition === position)?.username ??
    t(`table.position.${position}`);
  const spectator = view.outcome === 'made' || view.outcome === 'missed';
  // A spectator's trays are N/S and E/W, in the same colours as their names.
  const trayLabelColor = (tray: HandResultTray) =>
    !spectator
      ? TONES[tray.side].label
      : tray.team === 'north_south'
        ? PidroColors.teamUs
        : PidroColors.teamThem;
  const teamLabel = (tray: HandResultTray) =>
    spectator
      ? t(tray.team === 'north_south' ? 'game.ns_short' : 'game.ew_short')
      : t(tray.side === 'ours' ? 'game.us' : 'game.them').toLocaleUpperCase();
  const bidders = t(result.hand.bidding_team === 'north_south' ? 'game.ns' : 'game.ew');
  const headline = t(view.headline.key, {
    team: bidders,
    n: view.headline.n ?? 0,
  });
  const pidroLine = view.pidro ? t('game.took_their_pidro', { name: name(view.pidro) }) : null;
  const bidLine = t('game.bid_took', { bid: view.bid, captured: formatNumber(view.won) });
  const spoken = (
    {
      'we-made': 'game.we_made',
      'we-missed': 'game.we_set',
      'they-made': 'game.they_made',
      'they-missed': 'game.they_set',
      made: 'game.team_made',
      missed: 'game.team_set',
    } as const
  )[view.outcome];
  const [us, them] = view.trays;

  // Phones lay the panel out to their width; an iPad draws the phone's panel at 1.25×.
  const tablet = L.profile.startsWith('tablet');
  const scale = tablet ? 1.25 : 1;
  const landscape = width > height;
  const compact = landscape && waiting;
  const room = (width - insets.left - insets.right) / scale - PidroSpacing.md * 2;
  const panelWidth = Math.min(room, landscape ? 560 : 358);
  // Cards shrink before a tray wraps: six in one tray still fit a small phone.
  const trayFixed = 3 + 28 + 52 + PidroSpacing.sm;
  const gaps = (n: number) => Math.max(0, n - 1) * PidroSpacing.xs;
  const cardW = Math.floor(
    Math.min(
      CARD_W,
      landscape
        ? (panelWidth - 2 * trayFixed - 10 - gaps(us.cards.length) - gaps(them.cards.length)) /
            Math.max(1, us.cards.length + them.cards.length)
        : (panelWidth - trayFixed - gaps(Math.max(us.cards.length, them.cards.length))) /
            Math.max(1, us.cards.length, them.cards.length)
    )
  );

  // Centred on the trick, kept between the header and the timer.
  const [panelHeight, setPanelHeight] = useState(300);
  const shown = panelHeight * scale;
  const minTop = headerTop(insets.top) + TABLE_HEADER + PidroSpacing.xs;
  const maxBottom = height - insets.bottom - PidroSpacing.lg;
  const top =
    Math.max(minTop, Math.min(maxBottom - shown, L.trick.cy - shown / 2)) -
    (panelHeight - shown) / 2;

  const appear = useSharedValue(still ? 1 : 0);
  const timeLeft = useSharedValue(1);
  useEffect(() => {
    if (still) return;
    appear.value = withTiming(1, { duration: 200 });
    if (!waiting) timeLeft.value = withTiming(0, { duration: closeMs, easing: Easing.linear });
  }, [still, closeMs, waiting, appear, timeLeft]);
  const fade = useAnimatedStyle(() => ({ opacity: appear.value }));
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: timeLeft.value }] }));

  let index = 0;
  const trays = view.trays.map((tray) => {
    const tone = TONES[tray.side];
    const sweep = view.all14 === tray.team;
    // Overlap buys larger faces without taking more horizontal room. The fan
    // stays fully posed with Reduce Motion; only the existing fly-in animates.
    const faceW = compact ? Math.min(30, cardW) : sweep ? Math.min(52, cardW * 1.2) : cardW;
    return (
      <View
        key={tray.team}
        testID={`hand-tray-${tray.team}`}
        style={[
          styles.tray,
          {
            backgroundColor: tone.tray,
            borderColor: tone.edge,
            minHeight: faceW * CARD_RATIO + (sweep ? 38 : 22),
            boxShadow: sweep ? PidroColors.handAll14Glow : undefined,
          },
        ]}>
        <View style={styles.who}>
          <PidroText role="metadata" style={[styles.eyebrow, { color: trayLabelColor(tray) }]}>
            {teamLabel(tray)}
          </PidroText>
          <PidroText role="title" style={[styles.figure, { color: tone.figure }]}>
            {formatNumber(tray.points)}
          </PidroText>
        </View>
        <View style={[styles.cards, sweep ? { gap: 0, paddingHorizontal: 4 } : null]}>
          {tray.cards.map(({ card, points }, cardIndex) => (
            <View
              key={`${card.suit}-${card.rank}`}
              style={
                sweep
                  ? {
                      marginLeft: cardIndex ? -faceW * 0.22 : 0,
                      transform: [
                        { translateY: Math.abs(cardIndex - (tray.cards.length - 1) / 2) * 2 },
                        { rotate: `${(cardIndex - (tray.cards.length - 1) / 2) * 5}deg` },
                      ],
                    }
                  : null
              }>
              <PointCard
                card={card}
                points={points}
                side={tray.side}
                width={faceW}
                delay={CARDS_FROM_MS + CARD_STAGGER_MS * index++}
                still={still}
                fanned={sweep}
              />
            </View>
          ))}
        </View>
      </View>
    );
  });

  const press = waiting ? (onContinue ? continueHand : undefined) : onClose;
  return (
    <Animated.View
      testID="hand-result"
      style={[StyleSheet.absoluteFill, styles.root, styles.scrim, fade]}>
      {celebrate ? (
        <VictoryRays
          center={{ x: width / 2, y: top + panelHeight / 2 }}
          size={Math.max(width, height) * 1.1}
          still={still}
        />
      ) : null}
      <Pressable
        testID="hand-result-backdrop"
        accessibilityRole="button"
        accessible={!waiting || !!onContinue}
        focusable={!waiting || !!onContinue}
        accessibilityState={{ disabled: pending }}
        accessibilityLiveRegion="polite"
        accessibilityLabel={
          waiting
            ? t('game.tap_to_continue')
            : t('game.result_accessibility', {
                headline: [view.all14 ? headline : null, t(spoken, { team: bidders }), pidroLine]
                  .filter(Boolean)
                  .join('. '),
                bid: view.bid,
                captured: formatNumber(view.won),
                usLabel: teamLabel(us),
                us: formatNumber(us.points),
                themLabel: teamLabel(them),
                them: formatNumber(them.points),
              })
        }
        onPress={press}
        style={StyleSheet.absoluteFill}
      />
      <Pressable
        testID="hand-result-panel"
        accessible={false}
        focusable={false}
        onPress={press}
        onLayout={(event) => setPanelHeight(event.nativeEvent.layout.height)}
        style={[
          styles.panel,
          compact && { gap: 4 },
          {
            top,
            width: panelWidth,
            left: (width - panelWidth) / 2,
            transform: [{ scale }],
          },
        ]}>
        <View style={styles.heading}>
          <PidroText role="metadata" style={styles.eyebrow} numberOfLines={1}>
            {t('game.log_bid', { who: name(view.bidder), amount: view.bid }).toLocaleUpperCase()}
            {view.trump ? (
              <PidroText
                role="metadata"
                style={[
                  styles.eyebrow,
                  { color: RED.has(view.trump) ? PidroColors.suitRedOnFelt : PidroColors.text },
                ]}>
                {` ${SUIT_SYMBOLS[view.trump]}`}
              </PidroText>
            ) : null}
          </PidroText>
          <Headline
            text={headline}
            loud={view.loud}
            celebrate={celebrate}
            color={
              view.all14
                ? TONES[view.trays.find((tray) => tray.team === view.all14)!.side].figure
                : undefined
            }
            landscape={landscape}
            compact={compact}
            still={still}
            delay={view.outcome === 'we-missed' ? 0 : 600}
          />
          <PidroText role="label" align="center" style={styles.bidLine}>
            {bidLine}
          </PidroText>
          {pidroLine ? (
            <Rise delay={1100} still={still}>
              <PidroText role="metadata" align="center" style={styles.pidroLine}>
                {pidroLine}
              </PidroText>
            </Rise>
          ) : null}
        </View>
        <View style={landscape ? styles.traysRow : styles.traysColumn}>{trays}</View>
        {waiting && onContinue ? (
          <TextLink
            testID="hand-continue"
            accessibilityRole="button"
            label={t('game.tap_to_continue')}
            disabled={pending}
            onPress={continueHand}
          />
        ) : null}
      </Pressable>
      {!waiting ? (
        <View
          testID="hand-result-timer"
          pointerEvents="none"
          style={[
            styles.track,
            landscape
              ? { left: (width - panelWidth) / 2, right: (width - panelWidth) / 2 }
              : { left: insets.left + PidroSpacing.md, right: insets.right + PidroSpacing.md },
            { bottom: insets.bottom + (landscape ? 18 : 30) },
          ]}>
          <Animated.View style={[styles.bar, bar]} />
        </View>
      ) : null}
      {celebrate && !still ? <VictoryConfetti /> : null}
    </Animated.View>
  );
}

/** Our made bid is stamped in, gold; anything else rises in quietly. */
function Headline({
  text,
  loud,
  celebrate,
  color,
  landscape,
  compact,
  still,
  delay,
}: {
  text: string;
  loud: boolean;
  celebrate: boolean;
  color?: string;
  landscape: boolean;
  compact: boolean;
  still: boolean;
  delay: number;
}) {
  const stamp = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (still || !loud) return;
    stamp.value = withDelay(STAMP_DELAY_MS, withTiming(1, { duration: 420 }));
  }, [still, loud, stamp]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(stamp.value, [0, 0.6, 1], [0, 1, 1]),
    transform: [
      { scale: interpolate(stamp.value, [0, 0.6, 1], [1.6, 0.95, 1]) },
      { rotate: `${interpolate(stamp.value, [0, 0.6, 1], [-8, -3, -3])}deg` },
    ],
  }));
  if (!loud) {
    return (
      <Rise delay={delay} still={still}>
        <PidroText role="title" align="center" style={styles.quietHeadline}>
          {text}
        </PidroText>
      </Rise>
    );
  }
  return (
    <Animated.View style={still ? null : style}>
      <PidroText
        testID="hand-result-headline"
        role="display"
        align="center"
        style={[
          styles.loudHeadline,
          landscape ? styles.loudLandscape : null,
          celebrate ? (landscape ? styles.sweepLandscape : styles.sweepHeadline) : null,
          compact ? (celebrate ? styles.loudLandscape : styles.compactHeadline) : null,
          color ? { color } : null,
        ]}>
        {text}
      </PidroText>
    </Animated.View>
  );
}

function Rise({ delay, still, children }: { delay: number; still: boolean; children: ReactNode }) {
  const rise = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (still) return;
    rise.value = withDelay(delay, withTiming(1, { duration: 300, easing: EASE_OUT }));
  }, [still, delay, rise]);
  const style = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: 10 * (1 - rise.value) }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

const CHIP_TONE: Record<PointsSide, { bg: string; ink: string }> = {
  ours: { bg: PidroColors.teamUs, ink: PidroColors.ink },
  theirs: { bg: PidroColors.teamThem, ink: PidroColors.teamThemInk },
  neutral: { bg: PidroColors.trickChipBg, ink: PidroColors.text },
};

/** A card that scored, its points on a chip; a five glows gold. It flies in from the trick. */
function PointCard({
  card,
  points,
  side,
  width,
  delay,
  still,
  fanned,
}: {
  card: Card;
  points: number;
  side: PointsSide;
  width: number;
  delay: number;
  still: boolean;
  fanned: boolean;
}) {
  const fly = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (still) return;
    fly.value = withDelay(delay, withTiming(1, { duration: CARD_FLY_MS, easing: EASE_OUT }));
  }, [still, delay, fly]);
  const style = useAnimatedStyle(() => ({
    opacity: fly.value,
    transform: [{ translateY: -60 * (1 - fly.value) }, { scale: 0.8 + 0.2 * fly.value }],
  }));
  const chip = CHIP_TONE[side];
  return (
    <Animated.View
      style={[
        styles.card,
        { width, height: width * CARD_RATIO, boxShadow: PidroColors.pointCardShadow },
        style,
      ]}>
      {/* A five's gold ring: solid, behind the card and its chip, never over them. */}
      {points >= PIDRO_POINTS ? <View pointerEvents="none" style={styles.fiveRing} /> : null}
      <Image
        source={getCardImage(card)}
        accessibilityIgnoresInvertColors
        style={styles.cardImage}
      />
      <View
        style={[
          styles.chip,
          fanned ? { top: -18, right: (width - 24) / 2 } : null,
          { backgroundColor: chip.bg },
          side === 'neutral' ? { borderColor: PidroColors.cyanBorderStrong } : null,
        ]}>
        <PidroText role="metadata" style={[styles.chipText, { color: chip.ink }]}>
          {`+${points}`}
        </PidroText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Under the score header and the menu, over the felt and the seats.
  root: { zIndex: 40 },
  scrim: { backgroundColor: PidroColors.handScrim },
  panel: { position: 'absolute', gap: 10 },
  heading: { alignItems: 'center', gap: 2, marginBottom: PidroSpacing.xs },
  eyebrow: {
    fontWeight: '900',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1,
    color: PidroColors.cyanText,
  },
  loudHeadline: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 48,
    lineHeight: 62,
    letterSpacing: 0,
    color: PidroBevel.textGold,
    ...PidroBevel.labelShadow,
  },
  loudLandscape: { fontSize: 44, lineHeight: 57 },
  sweepHeadline: { fontSize: 60, lineHeight: 78 },
  sweepLandscape: { fontSize: 52, lineHeight: 68 },
  compactHeadline: { fontSize: 38, lineHeight: 49 },
  quietHeadline: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 30,
    lineHeight: 39,
    letterSpacing: 0,
  },
  bidLine: { fontSize: 15, lineHeight: 20 },
  pidroLine: { color: PidroBevel.textGold },
  traysColumn: { gap: 10 },
  traysRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'stretch', gap: 10 },
  tray: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.sm,
    paddingTop: PidroSpacing.sm,
    paddingBottom: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  who: { width: 52, alignItems: 'flex-start' },
  figure: { fontWeight: '900', fontSize: 26, lineHeight: 34 },
  cards: { flexDirection: 'row', gap: PidroSpacing.xs },
  card: { borderRadius: PidroRadii.tight },
  fiveRing: {
    position: 'absolute',
    left: -3,
    right: -3,
    top: -3,
    bottom: -3,
    borderRadius: PidroRadii.tight + 3,
    backgroundColor: PidroBevel.textGold,
    boxShadow: PidroColors.pointCardFiveGlow,
  },
  cardImage: { width: '100%', height: '100%', borderRadius: PidroRadii.tight },
  chip: {
    position: 'absolute',
    zIndex: 2,
    right: -8,
    top: -9,
    minWidth: 24,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: PidroRadii.full,
    borderWidth: 1.5,
    borderColor: PidroBevel.panelDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontWeight: '900', fontSize: 11, lineHeight: 14, letterSpacing: 0 },
  track: {
    position: 'absolute',
    height: 4,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroColors.border,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: PidroRadii.full,
    backgroundColor: PidroColors.cyanText,
    transformOrigin: 'left',
  },
});
