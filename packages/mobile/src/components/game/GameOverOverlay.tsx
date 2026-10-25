import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gradientBg } from '@/components/ui/Bevel';
import { BevelButton } from '@/components/ui/BevelButton';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { HandHistory } from './HandHistory';
import { all14Team } from '@/features/game/handResult';
import {
  PidroBevel,
  PidroColors,
  PidroFonts,
  PidroGameOver,
  PidroRadii,
  PidroSpacing,
} from '@/design/tokens';
import { canViewPlayer } from '@/features/friends';
import {
  bestHand,
  bestHandLine,
  lastTrickReveal,
  nameList,
  othersAreBots,
  pointCardsTaken,
  raceLine,
  streakChip,
  xpChip,
} from '@/features/game/gameOver';
import type { ProgressionSummary } from '@/channels/hooks/useGameChannel';
import { playBigTrickHaptic, playOurPidroHaptic } from '@/game/useGameHaptics';
import { formatNumber, t, useTranslation } from '@/i18n';
import type { BotPersona, RematchVote } from '@pidro/shared';
import type { GameViewModel, RelativePlayerView, ServerGameState, TeamKey } from '@/types/game';
import { isNorthSouthTeam, resolveWinningTeam } from '@/utils/positions';
import { isStillCapture } from '@/utils/stillCapture';
import { BestHandFan, LastTrickStage } from './GameOverCards';
import { RaceChart } from './RaceChart';
import { RematchRow, type RematchSeatView } from './RematchRow';
import { VictoryConfetti, VictoryRays } from './VictoryConfetti';

interface GameOverOverlayProps {
  viewModel: GameViewModel;
  serverState: ServerGameState;
  progressionSummary?:
    | (Pick<ProgressionSummary, 'xp_earned' | 'veteran_level' | 'leveled_up'> &
        Partial<Pick<ProgressionSummary, 'veteran_progress' | 'partner'>>)
    | null;
  onHome: () => void;
  onPlayAgain: () => void;
  rematch?: RematchVote | null;
  rematchPending?: boolean;
  playAgainLabel?: string;
  /** Guests see no race chart: one link to every hand is enough. */
  guest?: boolean;
  showGuestSave?: boolean;
  onSaveGuest?: () => void;
  onProfile?: (playerId: string | null, persona?: BotPersona | null) => void;
}

function displayName(player: RelativePlayerView): string {
  if (player.isYou) return t('game.you');
  if (player.username) return player.username;
  if (player.seatStatus === 'bot_substitute' || player.seatStatus === 'permanent_bot')
    return t('game.bot');
  return t(`table.position.${player.absolutePosition}`);
}

const teamOf = (player: RelativePlayerView): TeamKey =>
  isNorthSouthTeam(player.absolutePosition) ? 'north_south' : 'east_west';

// The store marks every bot seat, crew or stand-in, `bot_substitute`; the
// server's rematch vote counts the same seats as bots.
const isBot = (player: RelativePlayerView) =>
  player.seatStatus === 'permanent_bot' ||
  player.seatStatus === 'bot_substitute' ||
  !!player.playerId?.startsWith('bot_');

/**
 * Phone sizes are the boards' (390 wide, 375×667 compact, 844×390 landscape);
 * a tablet takes the phone column at 1.15×, centred, in either orientation.
 * `tier` steps the reveal down as height runs out: decoration yields first.
 */
function useLayout() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const w = width - insets.left - insets.right - PidroSpacing.md * 2;
  const h = height - insets.top - insets.bottom - PidroSpacing.sm * 2;
  const tablet = Math.min(width, height) >= 600;
  const k = tablet ? 1.15 : 1;
  const landscape = width > height && !tablet;
  const room = h / k;
  const tier: 0 | 1 | 2 = landscape ? (room >= 300 ? 1 : 2) : room >= 730 ? 0 : room >= 600 ? 1 : 2;
  return {
    insets,
    landscape,
    k,
    tier,
    tablet,
    // A small phone (375×667): under 700pt of room, not a notched 390×844 or a tablet.
    short: !landscape && !tablet && room < 700,
    frame: landscape
      ? { width: Math.min(w, 740), height: h }
      : { width: Math.min(w, 400 * k), height: h },
    rays: {
      center: landscape
        ? { x: insets.left + w * 0.27, y: insets.top + h * 0.3 }
        : { x: width / 2, y: insets.top + h * 0.18 },
      size: Math.max(width, height) * 1.1,
    },
  };
}

type Beat =
  'stage' | 'fan' | 'plaque' | 'headline' | 'score' | 'best' | 'chart' | 'chips' | 'footer';
const BEATS: Beat[] = [
  'stage',
  'fan',
  'plaque',
  'headline',
  'score',
  'best',
  'chart',
  'chips',
  'footer',
];
// Win-Beats: the card rises, the headline lands, the score slams, the line
// draws, the chips rise. A loss only lets each block come up in turn.
const WIN: Partial<Record<Beat, [number, number]>> = {
  stage: [150, 700],
  fan: [600, 500],
  plaque: [900, 380],
  headline: [950, 380],
  score: [1050, 520],
  chart: [1500, 600],
  chips: [2200, 380],
  footer: [300, 300],
};
const QUIET: Partial<Record<Beat, [number, number]>> = {
  headline: [0, 380],
  score: [0, 380],
  best: [400, 380],
  chart: [900, 380],
  chips: [1600, 380],
  footer: [300, 300],
};

/** One timeline for the reveal. A tap anywhere jumps to the end. */
function useBeats(win: boolean) {
  const calm = useReducedMotion() || isStillCapture();
  const [values] = useState(
    () =>
      Object.fromEntries(BEATS.map((beat) => [beat, new Animated.Value(calm ? 1 : 0)])) as Record<
        Beat,
        Animated.Value
      >
  );
  const animation = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (calm) {
      if (win) playOurPidroHaptic();
      return;
    }
    const plan = win ? WIN : QUIET;
    const run = Animated.parallel(
      BEATS.map((beat) => {
        const [delay, duration] = plan[beat] ?? [0, 0];
        return Animated.timing(values[beat], {
          toValue: 1,
          delay,
          duration,
          easing: beat === 'stage' ? Easing.out(Easing.back(1.4)) : Easing.out(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        });
      })
    );
    animation.current = run;
    run.start();
    // The score lands: success, then one heavy.
    const timers = win
      ? [setTimeout(playOurPidroHaptic, 1050), setTimeout(playBigTrickHaptic, 1200)]
      : [];
    return () => {
      run.stop();
      timers.forEach(clearTimeout);
    };
  }, [calm, values, win]);

  const skip = useCallback(() => {
    if (!animation.current) return;
    animation.current.stop();
    animation.current = null;
    BEATS.forEach((beat) => values[beat].setValue(1));
  }, [values]);

  return { values, skip, calm };
}

const rise = (value: Animated.Value) => ({
  opacity: value,
  transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
});

export function GameOverOverlay({
  viewModel,
  serverState,
  progressionSummary,
  onHome,
  onPlayAgain,
  rematch,
  rematchPending = false,
  playAgainLabel,
  guest = false,
  showGuestSave = false,
  onSaveGuest,
  onProfile,
}: GameOverOverlayProps) {
  useTranslation();
  const { insets, landscape, k, tier, tablet, short, frame, rays } = useLayout();
  const z = (n: number) => Math.round(n * k);
  const you = viewModel.players.find((player) => player.isYou);
  const spectator = !you;
  const rawScores = serverState.scores ?? { north_south: 0, east_west: 0 };
  const winningTeam = resolveWinningTeam(serverState.winner, rawScores);
  const tied = winningTeam == null;
  // The viewer's side reads first; a spectator follows the winners.
  const ours: TeamKey = you ? teamOf(you) : (winningTeam ?? 'north_south');
  const theirs: TeamKey = ours === 'north_south' ? 'east_west' : 'north_south';
  const viewerWon = !spectator && winningTeam === ours;
  const history = serverState.hand_history ?? [];
  const [historyOpen, setHistoryOpen] = useState(false);
  const lastHand = serverState.last_hand ?? null;
  const ourBest = bestHand(history, ours);
  const best = !spectator && !viewerWon ? ourBest : null;
  // A loss opens on your best hand, so it links to every hand instead of charting them.
  const race = history.length && !guest && !best ? raceLine(history, ours) : null;
  const streak = spectator ? null : streakChip(progressionSummary?.partner);
  const xp = spectator ? null : xpChip(progressionSummary);
  const partner = viewModel.players.find(
    (player) => !player.isYou && you && teamOf(player) === ours
  );
  const namesOf = (team: TeamKey) =>
    nameList(viewModel.players.filter((player) => teamOf(player) === team).map(displayName));
  const hands = history.length || lastHand?.hand_number || 0;
  const { values: beat, skip, calm } = useBeats(viewerWon);

  const headline = tied
    ? t('game.tie')
    : viewerWon
      ? partner
        ? t('game.you_and_partner_win', { partner: displayName(partner) })
        : t('game.won')
      : t('game.names_win', { names: namesOf(winningTeam) });
  const firstLabel = spectator ? t(ours === 'north_south' ? 'game.ns' : 'game.ew') : t('game.us');
  const secondLabel = spectator
    ? t(theirs === 'north_south' ? 'game.ns' : 'game.ew')
    : t('game.them');

  const others: RematchSeatView[] = viewModel.players
    .filter((player) => !player.isYou)
    .map((player) => {
      const seat = rematch?.seats?.find((s) => s.position === player.absolutePosition);
      const bot = seat?.bot ?? isBot(player);
      return {
        name: displayName(player),
        bot,
        agreed: seat ? seat.agreed : bot,
        avatarUrl: player.avatar_url,
        playerId: canViewPlayer(player) ? player.playerId : null,
        persona: player.bot_persona,
        botProfile: player.bot_profile,
      };
    });
  const youAgreed = !!rematch?.youAgreed;
  // Bots always agree: a row of three ticks says nothing.
  const showRematch = !spectator && !othersAreBots(others);
  // The last trick's card is decoration: it shows when there is room for it,
  // and on a short screen only when nothing else competes for its column. In
  // landscape the win has the left column to itself.
  const lean = landscape || (!streak && !xp && !race && !showRematch);
  const reveal =
    viewerWon && (tier === 0 || (tier === 1 && (lean || tablet)))
      ? lastTrickReveal(lastHand)
      : null;
  // A small phone's loss keeps the result, the best hand and the way on.
  const compactLoss = !viewerWon && !tied && short;
  // One hand count on screen: the chart's header owns it when there is one.
  const eyebrow = reveal
    ? t('game.winning_trick')
    : hands && !race && !compactLoss
      ? t('game.over_hands', { count: hands })
      : null;

  // Sizes for this tier, at the tablet's 1.15×.
  // The card and the score give way (0.8×) when the chart, chips and rematch row share the screen.
  const heroWidth = z(
    (landscape ? (tier === 1 ? 76 : 62) : tier === 0 ? 112 : 88) * (lean || landscape ? 1 : 0.8)
  );
  const big = z(
    (landscape ? (tier === 1 ? 64 : 52) : tier === 0 ? 104 : tier === 1 ? 78 : 60) *
      (lean || landscape ? 1 : 0.8)
  );
  const small = z(landscape ? 30 : tier === 0 ? 46 : tier === 1 ? 38 : 32);
  const quietScore = z(landscape ? 40 : tier === 0 ? 52 : tier === 1 ? 44 : 38);
  const headlineSize = z(
    viewerWon ? (landscape || tier > 0 ? 30 : 36) : landscape || tier > 0 ? 24 : 28
  );
  const chartHeight = z(tier === 0 ? 70 : tier === 2 ? 54 : 62);
  const gap = z(tier === 0 ? PidroSpacing.lg : tier === 1 ? PidroSpacing.md : PidroSpacing.sm);

  const eyebrowText = (text: string, color: string) => (
    <PidroText
      role="metadata"
      align="center"
      // Over the rays, cream needs a dark edge to read.
      style={[
        styles.eyebrow,
        viewerWon && PidroBevel.labelShadow,
        { color, fontSize: z(14), lineHeight: z(19) },
      ]}>
      {text}
    </PidroText>
  );

  const heading =
    eyebrow && tier < 2 ? (
      <Animated.View style={[rise(beat.headline), { marginBottom: z(8) }]}>
        {eyebrowText(eyebrow, viewerWon ? PidroColors.textOnWood : PidroColors.cyanText)}
      </Animated.View>
    ) : null;

  const stage = reveal ? (
    <View testID="game-over-trick" style={styles.stage}>
      <LastTrickStage
        winner={reveal.winner}
        others={reveal.others}
        trump={lastHand?.trump}
        width={heroWidth}
        rise={beat.stage}
        fan={beat.fan}
        sweep={!calm}
      />
    </View>
  ) : null;

  // The plaque captions the card; without the card it would read before the result.
  const plaque =
    reveal && lastHand ? (
      <Animated.View style={[styles.plaque, rise(beat.plaque), reveal && { marginTop: -z(14) }]}>
        <Icon name="star" size={z(15)} color={PidroBevel.textGold} />
        <PidroText role="label" style={[styles.plaqueText, { fontSize: z(15), lineHeight: z(20) }]}>
          {ourBest && all14Team(ourBest) === ours
            ? t('game.all_14_in_hand', { number: ourBest.hand_number })
            : t('game.last_hand_plaque', {
                bid: lastHand.bid,
                captured: lastHand.captured[lastHand.bidding_team],
              })}
        </PidroText>
      </Animated.View>
    ) : null;

  const title = (
    <Animated.View testID="game-over-headline" style={rise(beat.headline)}>
      <PidroText
        accessibilityRole="header"
        align="center"
        numberOfLines={2}
        style={[
          styles.headline,
          viewerWon ? styles.headlineWin : null,
          { fontSize: headlineSize, lineHeight: Math.round(headlineSize * 1.18) },
        ]}>
        {headline}
      </PidroText>
    </Animated.View>
  );

  const scoreLabel = (text: string, color: string) => (
    <PidroText
      role="metadata"
      numberOfLines={1}
      style={[styles.eyebrow, { color, fontSize: z(14), lineHeight: z(19) }]}>
      {text}
    </PidroText>
  );

  const score = (
    <Animated.View
      testID="game-over-score"
      accessible
      accessibilityLabel={`${firstLabel} ${rawScores[ours]}, ${secondLabel} ${rawScores[theirs]}`}
      style={[
        styles.scores,
        { gap: z(viewerWon ? 18 : 22), marginTop: z(12) },
        viewerWon
          ? {
              opacity: beat.score.interpolate({
                inputRange: [0, 0.3, 1],
                outputRange: [0, 1, 1],
              }),
              transform: [
                {
                  scale: beat.score.interpolate({
                    inputRange: [0, 0.55, 0.75, 1],
                    outputRange: [2.4, 0.92, 1.04, 1],
                  }),
                },
              ],
            }
          : rise(beat.score),
      ]}>
      <View style={styles.team}>
        {scoreLabel(firstLabel, PidroGameOver.oursLabel)}
        <PidroText
          testID="result-score-first"
          style={[
            styles.number,
            viewerWon
              ? [styles.bigGold, { fontSize: big, lineHeight: Math.round(big * 1.05) }]
              : { fontSize: quietScore, lineHeight: Math.round(quietScore * 1.12) },
          ]}>
          {formatNumber(rawScores[ours])}
        </PidroText>
      </View>
      <View style={[styles.team, styles.fixed, viewerWon && { paddingBottom: z(10) }]}>
        {scoreLabel(
          secondLabel,
          viewerWon || spectator ? PidroColors.cyanText : PidroGameOver.theirs
        )}
        <PidroText
          testID="result-score-second"
          style={[
            styles.number,
            viewerWon
              ? [styles.theirsAfterWin, { fontSize: small, lineHeight: Math.round(small * 1.1) }]
              : [
                  !spectator && !tied && styles.theirsWon,
                  { fontSize: quietScore, lineHeight: Math.round(quietScore * 1.12) },
                ],
          ]}>
          {formatNumber(rawScores[theirs])}
        </PidroText>
      </View>
    </Animated.View>
  );

  const bestHandCard = best ? (
    <Animated.View style={rise(beat.best)}>
      <Surface
        testID="best-hand"
        variant="window"
        style={[styles.best, { padding: z(tier === 0 ? 16 : tier === 1 ? 12 : 8) }]}>
        <View style={[styles.bestBody, { gap: z(14) }]}>
          {tier < 2 && pointCardsTaken(best, ours).length ? (
            <BestHandFan
              cards={pointCardsTaken(best, ours)}
              width={z(landscape ? 40 : tier === 0 ? 58 : 46)}
            />
          ) : null}
          <View style={styles.bestText}>
            <PidroText
              role="metadata"
              style={[
                styles.eyebrow,
                { color: PidroBevel.textGold, fontSize: z(14), lineHeight: z(19) },
              ]}>
              {t('game.best_hand')}
            </PidroText>
            <PidroText
              style={[
                styles.bestTitle,
                { fontSize: z(tier === 0 ? 26 : 22), lineHeight: z(tier === 0 ? 31 : 27) },
              ]}>
              {all14Team(best) === ours
                ? t('game.all_14')
                : t('game.won_of', {
                    captured: best.captured[ours],
                    total: serverState.config?.max_bid ?? 14,
                  })}
            </PidroText>
            <PidroText
              role="body"
              style={{ color: PidroColors.textSoft, fontSize: z(15), lineHeight: z(20) }}>
              {bestHandLine(
                best,
                ours,
                displayName(
                  viewModel.players.find((player) => player.absolutePosition === best.bidder) ??
                    you!
                )
              )}
            </PidroText>
          </View>
        </View>
      </Surface>
    </Animated.View>
  ) : null;

  // In the chart's header the link sits tight to the title; alone it is centred.
  const everyHand = (inChart: boolean) => (
    <TextLink
      testID="every-hand"
      label={t('game.every_hand_link')}
      size={inChart ? 15 : 16}
      style={inChart && styles.chartLink}
      onPress={() => setHistoryOpen(true)}
    />
  );

  const chart = race ? (
    <Animated.View style={rise(beat.chart)}>
      <View
        testID="how-it-went"
        accessibilityLabel={`${t('game.how_it_went')}. ${t('game.how_it_went_label', {
          us: rawScores[ours],
          them: rawScores[theirs],
        })}`}
        style={[styles.chart, { paddingHorizontal: z(12), paddingBottom: z(tier === 2 ? 6 : 10) }]}>
        <View style={styles.chartHeader}>
          <PidroText
            role="metadata"
            numberOfLines={2}
            style={[
              styles.eyebrow,
              styles.chartTitle,
              { color: PidroColors.cyanText, fontSize: z(14), lineHeight: z(19) },
            ]}>
            {t('game.how_it_went_hands', { count: history.length })}
          </PidroText>
          {everyHand(true)}
        </View>
        <RaceChart
          us={race.us}
          them={race.them}
          turn={null}
          target={serverState.config?.winning_score ?? 62}
          height={chartHeight}
          scale={k}
        />
      </View>
    </Animated.View>
  ) : history.length ? (
    <Animated.View style={rise(beat.chart)}>{everyHand(false)}</Animated.View>
  ) : null;

  const chipStyle = [styles.chip, { height: z(34), paddingHorizontal: z(12), gap: z(6) }];
  const chipText = { fontSize: z(13), lineHeight: z(18) };
  // Quiet on purpose: a way on, never louder than Play again.
  const guestRow =
    showGuestSave && onSaveGuest ? (
      <Animated.View style={[rise(beat.chips), { marginTop: z(8) }]}>
        <PressableFX
          testID="guest-save"
          accessibilityRole="button"
          accessibilityLabel={`${t('game.play_people')}. ${t('game.save_first')}`}
          onPress={onSaveGuest}
          style={[styles.guestRow, { minHeight: z(56), gap: z(14) }]}>
          <Icon name="friends" size={z(20)} color={PidroColors.cyanText} />
          <View style={styles.guestText}>
            <PidroText role="label" style={{ fontSize: z(17), lineHeight: z(23) }}>
              {t('game.play_people')}
            </PidroText>
            <PidroText
              role="body"
              style={{ color: PidroColors.textSoft, fontSize: z(15), lineHeight: z(20) }}>
              {t('game.save_first')}
            </PidroText>
          </View>
          <Icon name="chevron-right" size={z(20)} color={PidroColors.cyanText} />
        </PressableFX>
      </Animated.View>
    ) : null;

  // Never more than one row: the streak chip gives way in width, not to a second row.
  const chips =
    (streak || xp) && !compactLoss ? (
      <Animated.View style={[styles.chips, rise(beat.chips)]}>
        {streak ? (
          <View testID="streak-chip" style={[chipStyle, styles.shrink]}>
            <PlayerAvatar
              size={z(22)}
              uri={partner?.avatar_url}
              kind={partner?.bot_persona ? 'bot' : 'player'}
              persona={partner?.bot_persona}
              botProfile={partner?.bot_profile}
              ring="gold"
            />
            <PidroText role="label" numberOfLines={1} style={[chipText, styles.shrink]}>
              {t('game.in_a_row_with', { count: streak.count, name: streak.name })}
            </PidroText>
          </View>
        ) : null}
        {xp ? (
          <View testID="xp-chip" style={chipStyle}>
            <PidroText role="label" numberOfLines={1} style={chipText}>
              <PidroText style={[styles.xp, chipText]}>+{formatNumber(xp.xp)}</PidroText> XP
              {progressionSummary?.leveled_up
                ? t('game.level', { level: progressionSummary.veteran_level })
                : ''}
            </PidroText>
          </View>
        ) : null}
      </Animated.View>
    ) : null;

  const footer = (
    <Animated.View style={[styles.footer, { gap: z(10) }, { opacity: beat.footer }]}>
      {showRematch ? (
        <RematchRow
          others={others}
          you={
            you && {
              name: displayName(you),
              bot: false,
              agreed: true,
              avatarUrl: you.avatar_url,
            }
          }
          youAgreed={youAgreed}
          onProfile={onProfile}
          scale={k}
        />
      ) : null}
      <View style={[styles.actions, { gap: z(10) }]}>
        {!spectator ? (
          <BevelButton
            testID="play-again"
            label={youAgreed ? t('game.waiting') : (playAgainLabel ?? t('game.rematch'))}
            leadingIcon={<Icon name="rematch" size={z(22)} color={PidroBevel.textGold} />}
            size="lg"
            weight="hero"
            disabled={!rematch || youAgreed}
            loading={rematchPending}
            onPress={onPlayAgain}
            style={styles.rematch}
          />
        ) : null}
        <BevelButton
          testID="game-over-home"
          accessibilityLabel={t('game.home')}
          material="glass"
          size="icon"
          onPress={onHome}
          style={styles.home}>
          <Icon name="home" size={z(24)} />
        </BevelButton>
      </View>
    </Animated.View>
  );

  const revealBlock = (
    <View style={[styles.reveal, { gap: z(tier === 2 ? 2 : 4) }]}>
      {heading}
      {stage}
      {plaque}
      {title}
      {score}
    </View>
  );

  return (
    <View
      testID="game-over-overlay"
      style={[styles.overlay, gradientBg(PidroGameOver.backdropGradient)]}
      accessibilityViewIsModal
      onTouchStart={skip}>
      {viewerWon ? <VictoryRays center={rays.center} size={rays.size} /> : null}
      <View
        style={[
          styles.safe,
          {
            paddingTop: insets.top + PidroSpacing.sm,
            paddingBottom: insets.bottom + PidroSpacing.sm,
            paddingLeft: insets.left + PidroSpacing.md,
            paddingRight: insets.right + PidroSpacing.md,
          },
        ]}>
        <View
          testID="game-over-window"
          style={[
            frame,
            landscape ? [styles.columns, { gap: z(PidroSpacing.lg) }] : [styles.column, { gap }],
          ]}>
          {landscape ? (
            <>
              <View style={[styles.side, { gap }]}>
                {revealBlock}
                {bestHandCard}
              </View>
              <View style={[styles.side, styles.sideRight, { gap }]}>
                {chart}
                {chips}
                {guestRow}
                {footer}
              </View>
            </>
          ) : (
            <>
              {revealBlock}
              {bestHandCard}
              {chart}
              {chips}
              {guestRow}
              {footer}
            </>
          )}
        </View>
      </View>
      {viewerWon ? <VictoryConfetti /> : null}
      {historyOpen ? (
        <HandHistory
          history={history}
          viewer={you?.absolutePosition ?? null}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    backgroundColor: PidroGameOver.backdrop,
  },
  safe: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // The content is one group, centred as a whole, with fixed gaps inside.
  column: { justifyContent: 'center' },
  columns: { flexDirection: 'row' },
  side: { flex: 1, minWidth: 0, justifyContent: 'center' },
  sideRight: { flex: 1.1 },
  reveal: { alignItems: 'center' },
  eyebrow: { fontWeight: '900', letterSpacing: 1.6, textTransform: 'uppercase' },
  stage: { alignItems: 'center' },
  plaque: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroBevel.panelDeep,
    borderWidth: 1.5,
    borderColor: PidroBevel.rim,
    boxShadow: PidroColors.plaqueShadow,
  },
  plaqueText: { fontWeight: '900', color: PidroBevel.textGold },
  headline: { fontFamily: PidroFonts.display, fontWeight: '400', color: PidroColors.text },
  headlineWin: { color: PidroBevel.textGold, ...PidroBevel.labelShadow },
  scores: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  team: { alignItems: 'center', flexShrink: 1, minWidth: 0 },
  fixed: { flexShrink: 0 },
  number: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    color: PidroColors.text,
    fontVariant: ['tabular-nums'],
  },
  bigGold: { color: PidroBevel.textGold, ...PidroGameOver.scoreGlow },
  theirsAfterWin: { color: PidroColors.textSoft },
  theirsWon: { color: PidroGameOver.theirsScore },
  best: { borderColor: PidroGameOver.bestEdge },
  bestBody: { flexDirection: 'row', alignItems: 'center' },
  bestText: { flex: 1, minWidth: 0, gap: 4 },
  bestTitle: { fontFamily: PidroFonts.display, fontWeight: '400', color: PidroBevel.textGold },
  chart: {
    borderRadius: PidroRadii.lg,
    borderWidth: 1,
    borderColor: PidroColors.border,
    backgroundColor: PidroGameOver.chartFace,
    gap: 2,
  },
  chartTitle: { flexShrink: 1, letterSpacing: 0.8 },
  chartLink: { paddingLeft: PidroSpacing.xxs },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: PidroSpacing.xxs,
    marginRight: -PidroSpacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'center',
    gap: PidroSpacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    borderRadius: PidroRadii.full,
    borderWidth: 1,
    borderColor: PidroGameOver.chipEdge,
    backgroundColor: PidroGameOver.chipFace,
  },
  shrink: { flexShrink: 1, minWidth: 0 },
  xp: { color: PidroBevel.textGold, fontWeight: '900' },
  guestRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PidroSpacing.xs },
  guestText: { flex: 1, minWidth: 0, gap: 2 },
  footer: {},
  actions: { flexDirection: 'row', alignItems: 'center' },
  rematch: { flex: 1, alignSelf: 'stretch' },
  home: { alignSelf: 'center' },
});
