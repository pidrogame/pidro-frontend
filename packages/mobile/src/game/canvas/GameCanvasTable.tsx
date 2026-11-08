/**
 * Skia game-table screen container. The canvas is the table surface; the existing
 * RN overlays (top bar, connection banner, info bar, bidding, trump, hand-select,
 * game-over) are layered ABOVE it, all driven by the shared controller (M4).
 * NOTE: web loads CanvasKit through the platform-specific loader before this
 * module is imported. Native imports this module directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { BotPersona, RematchVote } from '@pidro/shared';
import type { Room } from '@/types/lobby';
import type { ActiveTurnTimer, Card, RelativePosition, ServerGameState, Suit } from '@/types/game';
import { useGameTableController } from '@/game/useGameTableController';
import { playSelectionHaptic, useTableHaptics } from '@/game/useGameHaptics';
import { usePlayGuard } from '@/game/usePlayGuard';
import { useGameStore } from '@/stores/game';
import { ConnectionBanner } from '@/components/ui/ConnectionBanner';
import { TableSettings } from './TableSettings';
import { WatchingBadge } from '@/components/game/WatchingBadge';
import { BiddingActions } from '@/components/game/BiddingActions';
import { TrumpPicker } from '@/components/game/TrumpPicker';
import { DealerSecondDeal } from '@/components/game/DealerSecondDeal';
import { GameOverOverlay } from '@/components/game/GameOverOverlay';
import { PlayerSheet } from '@/components/profile/PlayerSheet';
import { canViewPlayer } from '@/features/friends';
import { botLines } from '@pidro/shared';
import { thinkingLine } from '@/features/game/tableVoice';
import { pushGameAction, type ProgressionSummary } from '@/channels/hooks/useGameChannel';
import { getRankLabel, SUIT_SYMBOLS } from '@/utils/cards';
import { useCardTextures } from './cardTextures';
import { buildTableModel, useTableModel, type TableModel } from './tableModel';
import { useHandPresentationReady } from './useHandPresentationReady';
import { useDealPresentation } from './useDealPresentation';
import { useSecondDealPresentation } from './useSecondDealPresentation';
import { usePlayPresentation } from './usePlayPresentation';
import { laidDown, useLayDownPresentation } from './useLayDownPresentation';
import { PLAY_CARD_TRAVEL_MS } from './animationTiming';
import { blockedTapNudges } from '@/features/game/playPresentation';
import { T } from './tokens';
import GameCanvas from './GameCanvas';
import { SeatLayer, type SeatTurn } from './SeatLayer';
import { teamLine, type SeatLine } from '@/features/game/seatLine';
import { Scoreboard } from './Scoreboard';
import type { TickerRestingLine } from './ActionTicker';
import { buildHandLog } from '@/game/handLog';
import { bidSeatLine, bidsShown } from '@/features/game/bidding';
import { isSoloTable, loneTrumpHolder } from '@/features/game/tableHelp';
import { handResultTiming, waitsForContinue } from '@/features/game/handResult';
import { useSettingsStore } from '@/stores/settings';
import { LastTrick, type LastTrickView } from './LastTrick';

import { TABLE_HEADER, headerTop, useTableReserves, useTableSize } from './TableChrome';
import { TableSignals, scoreGlow, tablePidro } from './TableSignals';
import { HandResultPanel, useHandResult, viewerOf } from './HandResult';
import { HandPoints } from './HandPoints';
import {
  AVATAR_SIZE,
  computeLayout,
  handRight,
  liftOverPack,
  northSeatBottom,
  showsTicker,
  TIGHT_AVATAR,
  TIGHT_SOUTH_GAP,
  tickerPlacement,
  trumpPicker,
  type HeldStyle,
} from './layout';
import { avatarParts } from '@/features/avatar';
import { RuleSetChip } from '@/components/rules/RuleSet';
import { RulesExplainer, useRulesExplainer } from '@/components/rules/RulesExplainer';
import { PidroBevel, PidroColors, PidroLayout, PidroRadii, PidroSpacing } from '@/design/tokens';
import { t, useTranslation } from '@/i18n';
import { TableFeedback } from '@/components/game/TableFeedback';
import type { TableNotice } from '@/game/tableNotices';
import { LeagueProgress } from '@/components/home/LeagueProgress';
import {
  TALK_ROW,
  TalkBand,
  TalkLanding,
  TalkOffer,
  TAIL_FOLD_MS,
  type TalkPlace,
} from '@/components/game/TableTalk';
import { TalkSheet } from '@/components/game/TalkSheet';
import { talker, talkTable, typingFor, unreadBy, type Said } from '@/features/game/talk';
import { useTableTalk, type TalkFixture } from '@/game/useTableTalk';

type Props = {
  room: Room;
  rulesFixtureSeen?: boolean;
  progressionSummary?: ProgressionSummary | null;
  leagueProgress?: { league: import('@pidro/shared').LeagueId; line: string } | null;
  onLeave: () => void;
  onPlayAgain?: () => void;
  rematch?: RematchVote | null;
  rematchPending?: boolean;
  /** False once the room has moved on from the finished game (next game starting). */
  roomFinished?: boolean;
  onHome?: () => void;
  playAgainLabel?: string;
  guest?: boolean;
  showGuestSave?: boolean;
  onSaveGuest?: () => void;
  /** How every hand holds its cards; fixtures try the styles. */
  held?: HeldStyle;
  /** Upright, the height of a card under the header (a seat invitation): the table starts below it. */
  topDock?: number;
  /** Fixtures: hold the loading bar at this share of the cards decoded. */
  loading?: number;
  /** Fixtures: table talk as it stands (`?fixture=talk-*`). */
  talkFixture?: TalkFixture;
  notice?: TableNotice | null;
  onDismissNotice?: () => void;
};

/** `value` as it was when `hold` began, for as long as it holds. */
function useHeldWhile<T>(value: T, hold: boolean): T {
  const [kept, setKept] = useState(value);
  if (!hold && kept !== value) setKept(value);
  return hold ? kept : value;
}

function cardLabel(card: Card): string {
  return `${getRankLabel(card.rank)}${SUIT_SYMBOLS[card.suit]}`;
}

function trickCardForPlayer(state: ServerGameState | null, absolutePosition: string): Card | null {
  const currentTrick = state?.current_trick;
  const plays = Array.isArray(currentTrick)
    ? currentTrick
    : currentTrick && typeof currentTrick === 'object' && 'plays' in currentTrick
      ? (currentTrick as unknown as { plays?: unknown }).plays
      : null;
  if (!Array.isArray(plays)) return null;
  const play = plays.find(
    (candidate: { player?: string; position?: string; card?: Card }) =>
      candidate?.player === absolutePosition || candidate?.position === absolutePosition
  );
  return play?.card ?? null;
}

function statusText(
  player: NonNullable<ReturnType<typeof useGameTableController>['viewModel']>['players'][number],
  state: ServerGameState | null,
  room: string
): SeatLine | null {
  const phase = state?.phase ?? 'bidding';
  const absolutePosition = player.absolutePosition;
  const bid = state?.bids?.[absolutePosition as keyof NonNullable<ServerGameState['bids']>];
  const cut = state?.dealer_selection_cuts?.[absolutePosition] ?? null;
  const playedCard = trickCardForPlayer(state, absolutePosition);
  const lastTrick =
    state?.tricks && state.tricks.length > 0 ? state.tricks[state.tricks.length - 1] : null;
  const thinking = thinkingLine(
    room,
    state?.hand_number ?? state?.round_number ?? 0,
    player.bot_persona,
    player.bot_profile
  );
  // A catalogue line runs to 40 characters; where the seat swaps in its short line, it says
  // the plain turn text instead (PID-405). The built-in lines always fit.
  const now = (text: string): SeatLine | null =>
    player.isCurrentTurn
      ? {
          text: thinking ?? text,
          ...(botLines(player.bot_profile) && { short: text }),
          tone: 'now',
        }
      : null;

  switch (phase) {
    case 'dealer_selection':
      if (cut) return { text: t('game.draws', { card: cardLabel(cut) }) };
      if (playedCard) return { text: t('game.draws', { card: cardLabel(playedCard) }) };
      return now(t('game.drawing'));
    case 'bidding':
      if (thinking && player.isCurrentTurn) return now(t('game.bidding'));
      return bidSeatLine({
        bid,
        holdsHigh: state?.highest_bid?.position === absolutePosition,
        onTurn: player.isCurrentTurn,
        hand: state?.hand_number ?? state?.round_number,
      });
    case 'declaring':
    case 'declaring_trump':
    case 'trump_declaration':
      if (player.isCurrentTurn) return now(t('game.choosing_trump'));
      return state?.trump ? { text: t('game.trump', { suit: SUIT_SYMBOLS[state.trump] }) } : null;
    case 'discarding':
    case 'second_deal':
      return now(t('game.picking'));
    case 'playing':
      if (playedCard) return { text: t('game.plays', { card: cardLabel(playedCard) }) };
      // The others are out of trumps: what is left is this player's.
      if (state?.pace !== 'own' && loneTrumpHolder(state?.players) === absolutePosition) {
        return { text: t('game.takes_rest'), short: t('game.all_yours'), tone: 'now' };
      }
      if (player.isCurrentTurn) return now(t('game.playing'));
      if (lastTrick?.winner === absolutePosition) return { text: t('game.took_trick') };
      return null;
    case 'scoring':
    case 'hand_complete':
      return null;
    case 'complete':
    case 'game_over':
      return { text: t('game.finished') };
    default:
      return now(t('game.playing'));
  }
}

/**
 * When this phone took in each server state; a busy phone takes them in late.
 * Watched from when the waiting room loads this module, before the table mounts.
 */
const arrivals = new WeakMap<object, number>();
useGameStore.subscribe((next, prev) => {
  if (next.serverState && next.serverState !== prev.serverState)
    arrivals.set(next.serverState, Date.now());
});

/** The turn light turns urgent for the last five seconds. */
const URGENT_MS = 5_000;

function useTurnTimerProgress(
  turnTimer: ActiveTurnTimer | null
): { position: string; turn: SeatTurn } | null {
  const [clock, setNow] = useState(() => Date.now());
  // A timer is received as it renders; an older clock would add the time before it.
  const now = Math.max(clock, turnTimer?.receivedAtMs ?? 0);
  const expiresAt =
    turnTimer && turnTimer.durationMs > 0 ? turnTimer.receivedAtMs + turnTimer.remainingMs : 0;

  // The arc keeps its own clock; the seats wake only when the light turns urgent and when it runs out.
  useEffect(() => {
    if (!expiresAt) return;
    const next = [expiresAt - URGENT_MS, expiresAt].find((at) => at >= now);
    if (next === undefined) return;
    const id = setTimeout(() => setNow(Date.now()), next - Date.now() + 1);
    return () => clearTimeout(id);
  }, [expiresAt, now]);

  if (!turnTimer || turnTimer.scope !== 'seat' || !turnTimer.position) return null;
  if (turnTimer.durationMs <= 0) return null;

  const remainingTotalMs = Math.max(0, expiresAt - now);
  if (remainingTotalMs <= 0) return null;

  const countdownRemainingMs = Math.min(turnTimer.durationMs, remainingTotalMs);
  return {
    position: turnTimer.position,
    turn: {
      progress: countdownRemainingMs / turnTimer.durationMs,
      urgent: countdownRemainingMs <= URGENT_MS,
      endsAt: expiresAt,
      durationMs: turnTimer.durationMs,
    },
  };
}

function TimedSeatLayer({
  seats,
  dealerRel,
  dealing,
  topReserve,
  bottomReserve,
  statusByRel,
  firstHand,
  nudge,
  players,
  onProfile,
  quiet,
  levels,
  pack,
  secondDeal,
  killed,
  layDown,
  held,
  bid,
  said,
}: {
  seats: TableModel['seats'];
  dealerRel: RelativePosition | null;
  dealing: boolean;
  topReserve: number;
  bottomReserve: number;
  statusByRel: Partial<Record<RelativePosition, SeatLine | null>> | undefined;
  firstHand: boolean;
  nudge: number;
  players: NonNullable<ReturnType<typeof useGameTableController>['viewModel']>['players'];
  onProfile: (playerId: string | null, persona?: BotPersona | null) => void;
  quiet: boolean;
  levels: boolean;
  pack: ComponentProps<typeof SeatLayer>['pack'];
  secondDeal: ComponentProps<typeof SeatLayer>['secondDeal'];
  killed: ComponentProps<typeof SeatLayer>['killed'];
  layDown: ComponentProps<typeof SeatLayer>['layDown'];
  held: ComponentProps<typeof SeatLayer>['held'];
  bid: ComponentProps<typeof SeatLayer>['bid'];
  said: ComponentProps<typeof SeatLayer>['said'];
}) {
  const turnTimer = useGameStore((state) => state.turnTimer);
  const ownPace = useGameStore((state) => state.serverState?.pace === 'own');
  const timerProgress = useTurnTimerProgress(ownPace ? null : turnTimer);
  const turnByRel = timerProgress
    ? players.reduce(
        (acc, player) => {
          if (player.absolutePosition === timerProgress.position) {
            acc[player.relativePosition] = timerProgress.turn;
          }
          return acc;
        },
        {} as Partial<Record<RelativePosition, SeatTurn>>
      )
    : undefined;

  return (
    <SeatLayer
      seats={seats}
      dealerRel={dealerRel}
      dealing={dealing}
      topReserve={topReserve}
      bottomReserve={bottomReserve}
      statusByRel={statusByRel}
      firstHand={firstHand}
      turnByRel={turnByRel}
      nudge={nudge}
      quiet={quiet}
      levels={levels}
      pack={pack}
      secondDeal={secondDeal}
      killed={killed}
      layDown={layDown}
      held={held}
      bid={bid}
      said={said}
      onProfile={Object.fromEntries(
        players
          .filter(
            (player) =>
              canViewPlayer(player) || (player.bot_persona && player.seatStatus !== 'vacant')
          )
          .map((player) => [
            player.relativePosition,
            () => onProfile(player.playerId, player.bot_persona),
          ])
      )}
    />
  );
}

export function GameCanvasTable({
  room,
  progressionSummary,
  leagueProgress,
  onLeave,
  onPlayAgain,
  rematch,
  rematchPending,
  roomFinished = true,
  onHome,
  playAgainLabel,
  guest,
  showGuestSave,
  onSaveGuest,
  rulesFixtureSeen,
  held,
  topDock = 0,
  loading,
  talkFixture,
  notice,
  onDismissNotice,
}: Props) {
  const { locale } = useTranslation();
  const controller = useGameTableController();
  const [profile, setProfile] = useState<
    Pick<ComponentProps<typeof PlayerSheet>, 'playerId' | 'persona'>
  >({ playerId: null });
  const openProfile = useCallback(
    (playerId: string | null, persona?: BotPersona | null) => setProfile({ playerId, persona }),
    []
  );
  const role = useGameStore((state) => state.role);
  const dealerRobPresentation = useGameStore((state) => state.presentation?.dealer_rob ?? null);
  const isPrivateDealerRob =
    controller.youPositionAbs === dealerRobPresentation?.dealer && !!dealerRobPresentation.pool;
  const isSpectator = role === 'spectator';
  const textures = useCardTextures();
  const countHelp = useSettingsStore((state) => state.countHelp);
  const showBid = useSettingsStore((state) => state.showBid);
  // Your own pick from the pack plays out in your hand: the pool lands in it,
  // and what you keep is what the server sends once the pick is done.
  const serverModel = useTableModel(
    controller,
    isPrivateDealerRob ? dealerRobPresentation.pool : undefined,
    countHelp
  );
  const solo = useGameStore((state) => isSoloTable(state.readiness, state.youPositionAbs));
  const readiness = useGameStore((state) => state.readiness);
  const lifecycleSeats = useGameStore((state) => state.lifecycle?.seats);
  // A settled hand is laid down first (PID-366): until the fan has gathered,
  // the table, its result and the scores stand as they were when it settled.
  const laid = useLayDownPresentation(controller.serverState, serverModel.seats);
  const laying = laid.before != null;
  const tableState = laid.before ?? controller.serverState;
  // A hand scored while watching dims the table until its result closes.
  const handResult = useHandResult(
    tableState ? (tableState.last_hand ?? null) : undefined,
    viewerOf(serverModel.seats),
    room.code,
    waitsForContinue(tableState ?? {}),
    serverModel.phase === 'dealing' || serverModel.phase === 'bidding'
  );
  // The server sends the next hand with the one that ended: the table holds
  // the hand that ended while its result shows, and deals once it closes.
  const holding = handResult.result != null || handResult.opening;
  const heldModel = useHeldWhile(serverModel, holding || laying);
  // Count help off, a hand ends as Classic's did (PID-332): its cards stay on
  // the table, the final trick's too, under the hand's points; halfway to the
  // deal they clear and the points stay alone.
  const ended = handResult.result?.hand;
  const classicEnd = !countHelp && !controller.isGameOver && ended != null;
  const endedNumber = classicEnd ? ended.hand_number : null;
  const [cleared, setCleared] = useState<number | null>(null);
  // A rematch numbers its hands afresh.
  if (endedNumber == null && cleared != null) setCleared(null);
  useEffect(() => {
    if (endedNumber == null) return;
    const timer = setTimeout(() => setCleared(endedNumber), handResultTiming.showMs / 2);
    return () => clearTimeout(timer);
  }, [endedNumber]);
  const endedTricks = classicEnd && cleared !== endedNumber ? ended.tricks : undefined;
  const tablePlayers = controller.players;
  const piles = useMemo(
    () =>
      endedTricks
        ? buildTableModel({
            phase: 'playing',
            trumpSuit: ended?.trump ?? null,
            players: tablePlayers,
            yourHand: null,
            yourCardCount: null,
            currentTrick: null,
            tricks: endedTricks,
            legalActions: [],
            currentTurnRelative: null,
            canPlay: false,
            getCardCountForPlayer: () => null,
          }).playedCards
        : {},
    [endedTricks, ended?.trump, tablePlayers]
  );
  // Under the result the hand is played out: no trick, no cards left in hand,
  // and with count help no cards on the table.
  const layDown = laying || holding ? laid.show : null;
  const tableModel = useMemo(
    () =>
      laidDown(
        holding
          ? {
              ...heldModel,
              yourHand: [],
              currentTrick: {},
              playedCards: piles,
              latestPlayKey: null,
              winningKey: null,
              trickPoints: null,
              // Classic's points take the trump mark's place; no seat is on turn,
              // and each says the last card it played until the cards clear.
              ...(classicEnd && {
                trumpSuit: null,
                currentTurnRelative: null,
                seats: Object.fromEntries(
                  Object.entries(heldModel.seats).map(([rel, seat]) => [
                    rel,
                    seat && {
                      ...seat,
                      isCurrentTurn: false,
                      lastPlayedCard: piles[rel as RelativePosition]?.at(-1) ?? null,
                    },
                  ])
                ) as TableModel['seats'],
              }),
            }
          : heldModel,
        layDown
      ),
    [holding, heldModel, piles, classicEnd, layDown]
  );
  // Catching up: what the server allows the dealer cut, and how late this phone is.
  const arrivedAt = controller.serverState ? arrivals.get(controller.serverState) : undefined;
  const selection = useGameStore((state) => state.presentation?.dealer_selection ?? null);
  const dealerSelectionMs = selection ? selection.ends_at_ms - selection.started_at_ms : undefined;
  const timedModel = useMemo(
    () => ({ ...tableModel, arrivedAt, dealerSelectionMs }),
    [tableModel, arrivedAt, dealerSelectionMs]
  );
  const dealt = useDealPresentation(timedModel, controller.viewModel?.dealerRelative ?? null);
  const presented = useSecondDealPresentation(
    dealt,
    isPrivateDealerRob ? dealerRobPresentation : null
  );
  const turnTimer = useGameStore((state) => state.turnTimer);
  // A tap the table did not play: the card shakes, the seat on turn lights, a light tick.
  const [nudge, setNudge] = useState(0);
  const playedAt = useRef(0);
  const { handlePlayCard } = controller;
  const sendPlay = useCallback(
    (card: Card) => {
      playedAt.current = Date.now();
      return handlePlayCard(card);
    },
    [handlePlayCard]
  );
  const onBlockedPlay = (reason: string) => {
    const inFlight =
      controller.isPlayingCard || Date.now() < playedAt.current + PLAY_CARD_TRAVEL_MS;
    // The deal, the sort and the second deal all count: the cards are still moving.
    const dealing = presented.dealStage != null;
    if (!blockedTapNudges(reason, { inFlight, dealing })) return;
    playSelectionHaptic();
    setNudge((count) => count + 1);
  };
  const playPresentation = usePlayPresentation(presented, sendPlay, turnTimer, onBlockedPlay);
  const model = useMemo(
    () => (held ? { ...playPresentation.model, held } : playPresentation.model),
    [playPresentation.model, held]
  );
  const isBiddingTurn = controller.phase === 'bidding' && controller.isYourTurn;
  const facesReady = useHandPresentationReady(serverModel.yourHand, textures, isBiddingTurn);
  // A held loading bar is a phone still decoding: its hand is not ready either.
  const isHandReady = !model.dealStage && facesReady && loading == null;
  const insets = useSafeAreaInsets();
  const reserves = useTableReserves({ top: TABLE_HEADER + topDock });
  const { topReserve, bottomReserve } = reserves;
  const ruleSet = controller.serverState?.variant ?? 'finnish';
  const rules = useRulesExplainer(
    ruleSet,
    isSpectator || !controller.youPositionAbs,
    rulesFixtureSeen
  );
  const { width, height } = useTableSize();
  const layout = computeLayout(width, height, insets, topReserve, bottomReserve);

  const {
    trumpSuit,
    serverState,
    youPositionAbs,
    isChannelJoined,
    isYourTurn,
    isSecondDeal,
    canSelectHand,
    isGameOver,
    showTrumpSelection,
    viewModel,
    yourHand,
    handleDeclareTrump,
    handleSelectHand,
  } = controller;

  // Picking trump, the hand lifts the suit pointed at. Nothing is lifted until
  // then: a pre-picked suit read as the game choosing for you (testers).
  const [pointedSuit, setPointedSuit] = useState<Suit | null>(null);
  const previewSuit = showTrumpSelection ? pointedSuit : null;

  const playCard = usePlayGuard(
    playPresentation.playCard,
    { presentation: dealerRobPresentation, handReady: isHandReady },
    onBlockedPlay
  );

  // Until the deal has played, the log and the seats show no bids (PID-267),
  // also while the last hand's result holds the next hand back.
  const dealing = holding || dealt.dealStage != null;
  const shownState = useMemo(() => bidsShown(tableState, dealing), [tableState, dealing]);
  // Bids sound once the deal has played, seen or not.
  useTableHaptics(model, dealt.dealUnseen ? undefined : shownState?.bid_order);

  const handLog = useMemo(
    () =>
      buildHandLog({
        handNumber: serverState?.hand_number ?? serverState?.round_number ?? null,
        bids: shownState?.bid_order,
        trump: serverState?.trump ?? null,
        tricks: controller.completedTricks,
        currentTrick: controller.currentTrick,
        lastHand: serverState?.last_hand ?? null,
        players: viewModel?.players ?? [],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildHandLog translates through the stable global t
    [
      locale,
      serverState?.hand_number,
      serverState?.round_number,
      shownState?.bid_order,
      serverState?.trump,
      serverState?.last_hand,
      controller.completedTricks,
      controller.currentTrick,
      viewModel?.players,
    ]
  );

  // Classic's "Bet 6": from the first bid, the ticker rests on who holds the
  // bid; between hands, on how the last hand ended.
  const highBid = shownState?.highest_bid;
  const bidLine =
    highBid && typeof highBid.amount === 'number'
      ? buildHandLog({
          handNumber: 0,
          bids: [highBid],
          trump: null,
          tricks: [],
          currentTrick: [],
          lastHand: null,
          players: viewModel?.players ?? [],
        })[0]?.entries[0]
      : undefined;
  const lastResult = handLog[0]?.finished ? handLog[0].entries.at(-1) : undefined;
  const resting: TickerRestingLine | null = bidLine
    ? { who: bidLine.who, what: bidLine.what, ours: bidLine.ours }
    : lastResult
      ? { who: lastResult.who, what: lastResult.what, ours: lastResult.ours }
      : null;

  const lastTrick = model.lastTrick;
  const lastTrickView: LastTrickView | null =
    countHelp && tableState?.phase === 'playing' && lastTrick
      ? {
          number: lastTrick.number,
          plays: lastTrick.plays.map(({ holder, card }) => {
            const seat = model.seats[holder];
            return {
              name: seat?.isYou
                ? t('game.you')
                : (seat?.username ?? t(`table.position.${seat?.absolutePosition ?? 'north'}`)),
              card,
              took: holder === lastTrick.winner,
            };
          }),
          lines: (handLog.at(-1)?.entries ?? []).filter(
            (entry) =>
              entry.trick === lastTrick.number && (entry.kind === 'trick' || entry.kind === 'two')
          ),
        }
      : null;
  const fullTicker = showsTicker(layout);

  // A trick's points glow the score column they landed in; their Pidro also lights the seat
  // that took it.
  // The points as each trick is taken (pops, the score's glow, a Pidro on its
  // seat) are count help, with the log: off, the table stays as Classic's.
  const pidro = countHelp ? tablePidro(model.lastTrick, model.seats) : null;
  const trickKey = `${tableState?.hand_number ?? tableState?.round_number ?? 0}:${model.lastTrick?.number}`;
  const statusByRel = viewModel?.players.reduce(
    (acc, player) => {
      // In the second deal the cards say what happens; only the dealer says it is dealing.
      const line = model.dealStage
        ? model.secondDealShow && player.relativePosition !== model.dealerRelative
          ? null
          : { text: t('game.dealing') }
        : laying && laid.show?.rel === player.relativePosition
          ? { text: t('game.takes_rest'), short: t('game.all_yours'), tone: 'now' as const }
          : statusText(player, shownState, room.code);
      acc[player.relativePosition] =
        pidro?.side === 'theirs' && pidro.seat === player.relativePosition
          ? { ...(line ?? { text: t('game.took_trick') }), pulse: `pidro-${trickKey}` }
          : line;
      return acc;
    },
    {} as Partial<Record<RelativePosition, SeatLine | null>>
  );
  const continueHand = isSpectator
    ? undefined
    : async () => {
        try {
          await pushGameAction('continue_hand', {});
          return true;
        } catch (error) {
          controller.showActionError('Continue', error);
          return false;
        }
      };
  // Table talk (PID-114): wherever someone else sits, a bot too (PID-408), never under game over.
  const players = viewModel?.players ?? [];
  const me = players.find((player) => player.isYou);
  const company = talkTable(readiness?.seats, lifecycleSeats);
  const talking = !isSpectator && !!youPositionAbs && !!company && !(isGameOver && roomFinished);
  const hand = serverState?.hand_number ?? serverState?.round_number ?? 0;
  const talk = useTableTalk(
    {
      seat: youPositionAbs,
      userId: me?.playerId ?? null,
      game: serverState?.game_instance_id,
    },
    {
      hand,
      trick: `${hand}:${serverState?.tricks?.length ?? 0}`,
      bidding: controller.phase === 'bidding',
      shown: talking,
    },
    talkFixture
  );
  // A sheet left open when talk stops (game over, a seat to a bot) must not reopen later.
  if (!talking && talk.sheet) talk.open(null);
  const talkPlace: TalkPlace = layout.profile.startsWith('tablet') ? 'column' : 'corner';
  // Upright phones (PID-393): the bubble's centre level with your avatar's,
  // which sits under your hand on a tight phone, above its name and line
  // otherwise. What it offers grows out of it as a tail (PID-396), into the
  // room left of it, short of your avatar and its turn light by a small step.
  const upright = layout.profile === 'phone-portrait';
  const yourSize = layout.tight ? TIGHT_AVATAR : AVATAR_SIZE[layout.profile];
  const yours = avatarParts(yourSize);
  const bubbleTop = layout.tight
    ? layout.hand.cy + layout.cardH / 2 + TIGHT_SOUTH_GAP + (yourSize - TALK_ROW) / 2
    : layout.bottom -
      PidroSpacing.xs -
      4 -
      yours.name.lineHeight -
      yours.status.lineHeight -
      (yourSize + TALK_ROW) / 2;
  const talkRoom = upright
    ? width -
      insets.right -
      PidroSpacing.sm -
      TALK_ROW -
      (width / 2 + (yours.turn?.radius ?? yourSize / 2) + PidroSpacing.xs)
    : width - insets.right - PidroSpacing.sm * 2 - handRight(layout, model.yourHand.length);
  // Landscape phones: while you deal, the offer's word card rises over your pack (PID-396).
  const talkLift =
    layout.profile === 'phone-landscape' && model.dealerRelative === 'south' && model.pack
      ? liftOverPack(layout, model.pack, height - insets.bottom - PidroSpacing.xs)
      : 0;
  const faced = players.find((player) => player.playerId === talk.person);
  // Whose sheet is open: a bot by its persona, one per table; anyone else by account.
  const sheetSeat =
    profile.persona || profile.playerId
      ? players.find((player) =>
          profile.persona
            ? player.seatStatus !== 'vacant' && player.bot_persona === profile.persona
            : player.playerId === profile.playerId
        )
      : undefined;
  // Someone else's sheet is where Quiet waits: a person's by account, a bot's by
  // persona (PID-408). Report is for people; a bot's sheet has none.
  const sheeted =
    sheetSeat && !sheetSeat.isYou && (!!profile.persona || !sheetSeat.bot_persona)
      ? talker(sheetSeat)
      : null;
  // Your turn while typing (PID-318): the keyboard goes, the cards come back, the words wait in the bubble.
  const [turnSeen, setTurnSeen] = useState(false);
  if (isYourTurn !== turnSeen) {
    setTurnSeen(isYourTurn);
    if (isYourTurn && talk.sheet === 'typing') talk.open(null);
  }
  const youSeat = youPositionAbs ? readiness?.seats?.[youPositionAbs] : undefined;
  // Typing needs another person who reads it: at a bot table, words and faces only.
  const typing = company === 'people' ? typingFor(youSeat?.reads_typed, !!guest) : null;
  // Someone who left the table takes the report question with them.
  if (!faced && talk.sheet === 'report') talk.open(null);
  // The speaker as they sat when they said it, not whoever sits there now.
  const who = (said: Said) => {
    const player =
      players.find((candidate) => talker(candidate) === said.userId) ??
      players.find((candidate) => candidate.absolutePosition === said.seat);
    return {
      name: player?.isYou ? t('game.you') : (player?.username ?? t('social.player')),
      color: player?.isYou
        ? PidroColors.cyanText
        : player?.isTeammate
          ? PidroColors.teamUs
          : PidroColors.teamThem,
    };
  };
  const said = Object.fromEntries(
    players.flatMap((player) => {
      const landed = talk.landed[player.absolutePosition];
      if (!landed) return [];
      const draw = (at: ComponentProps<typeof TalkLanding>['at'], ring: number) => (
        <TalkLanding
          key={landed.key}
          landed={landed}
          at={at}
          ring={ring}
          name={who(landed).name}
          rise={player.isYou ? 60 : 12}
          // Upright, yours rises once the offer's tail has folded back (PID-396).
          wait={upright && player.isYou ? TAIL_FOLD_MS + 60 : 0}
        />
      );
      return [[player.relativePosition, draw]];
    })
  );

  // While you type the table shrinks to fit above the composer, like a stream beside its chat.
  // Your hand may slide under it: you cannot play while typing, and your turn closes the box.
  // A tight phone's seats are already the smallest tap targets, so its table keeps its size.
  const [dock, setDock] = useState<number | null>(null);
  const fit =
    talk.sheet === 'typing' && dock != null && height > width && !layout.tight
      ? Math.min(1, (dock - insets.top) / (layout.hand.cy - layout.cardH / 2 - insets.top))
      : 1;
  const reduceMotion = useReducedMotion();
  const fitted = useSharedValue(1);
  useEffect(() => {
    fitted.set(
      reduceMotion ? fit : withTiming(fit, { duration: 260, easing: Easing.out(Easing.cubic) })
    );
  }, [fit, fitted, reduceMotion]);
  const notch = insets.top;
  // A frame, not a cut: a thick rounded border in the composer's colour hides what runs past it.
  // Only transforms and opacity move, so an old phone has no clipping to redo each frame.
  const framed = fit < 1 && dock != null;
  const frameStyle = useAnimatedStyle(() => ({
    opacity: fit < 1 ? Math.min(1, (1 - fitted.get()) / (1 - fit)) : 0,
  }));
  const fittedStyle = useAnimatedStyle(() => ({
    // Hung from below the notch, so the scores stay clear of it.
    transform: [{ translateY: notch * (1 - fitted.get()) }, { scale: fitted.get() }],
  }));

  return (
    <View style={styles.stage}>
      <Animated.View style={[styles.fitted, fittedStyle]}>
        <GestureHandlerRootView testID="game-table" style={styles.root}>
          {/* The table surface */}
          <GameCanvas
            model={model}
            textures={textures}
            onPlayCard={playCard}
            onBlockedPlay={onBlockedPlay}
            nudge={nudge}
            topReserve={topReserve}
            bottomReserve={bottomReserve}
            previewSuit={previewSuit}
          />

          {/* Seat furniture (avatars, names, dealer chip, turn rings, opponent backs) over the canvas */}
          <TimedSeatLayer
            seats={model.seats}
            dealerRel={
              controller.phase === 'dealer_selection'
                ? null
                : laying
                  ? model.dealerRelative
                  : (viewModel?.dealerRelative ?? null)
            }
            dealing={model.dealStage === 'dealing'}
            topReserve={topReserve}
            bottomReserve={bottomReserve}
            // The next hand's lines wait for its deal.
            statusByRel={classicEnd ? undefined : statusByRel}
            // A rematch is a new game: its first hand says who your partner is again.
            firstHand={(tableState?.hand_number ?? tableState?.round_number) === 1}
            nudge={nudge}
            players={viewModel?.players ?? []}
            onProfile={openProfile}
            quiet={handResult.result != null && !classicEnd}
            levels={controller.phase === 'dealer_selection' || isGameOver}
            pack={model.pack}
            secondDeal={model.secondDealShow}
            killed={model.killed}
            layDown={model.layDown}
            held={model.held}
            said={talking ? said : undefined}
            bid={
              showBid &&
              !dealing &&
              [
                'declaring',
                'declaring_trump',
                'trump_declaration',
                'discarding',
                'second_deal',
                'playing',
              ].includes(tableState?.phase ?? '') &&
              highBid &&
              typeof highBid.amount === 'number'
                ? {
                    seat: viewModel?.players.find(
                      (player) => player.absolutePosition === highBid.position
                    )?.relativePosition,
                    amount: highBid.amount,
                  }
                : undefined
            }
          />
          {countHelp ? (
            <TableSignals model={model} topReserve={topReserve} bottomReserve={bottomReserve} />
          ) : null}

          {/* Talk yields to the loading bar, a notice and the connection banner while they show. */}
          {talking &&
          isChannelJoined &&
          !notice &&
          !controller.actionNotice &&
          loading == null &&
          !textures.loading ? (
            <View
              pointerEvents="box-none"
              style={[
                styles.talk,
                talkPlace === 'column'
                  ? {
                      right: insets.right + PidroSpacing.lg,
                      bottom: insets.bottom + PidroSpacing.md,
                      width: TALK_COLUMN,
                    }
                  : upright
                    ? { right: insets.right + PidroSpacing.sm, top: bubbleTop }
                    : {
                        right: insets.right + PidroSpacing.sm,
                        bottom: insets.bottom + PidroSpacing.xs,
                      },
              ]}>
              {talk.offer && !upright ? (
                <TalkOffer
                  offer={talk.offer}
                  place={talkPlace}
                  dim={isYourTurn}
                  hold={!!talkFixture}
                  room={talkRoom}
                  lift={talkLift}
                  unread={talk.unread}
                  onSend={talk.send}
                  onOpen={() => talk.open(typing === 'type' ? 'typing' : 'words')}
                />
              ) : (
                // Upright, one bubble through the offer, so its tail can fold back (PID-396).
                <TalkBand
                  place={talkPlace}
                  line={talk.line}
                  lineName={talk.line ? who(talk.line).name : ''}
                  draft={talk.draft}
                  turn={isYourTurn}
                  unread={talk.unread}
                  offer={talk.offer}
                  room={talkFixture?.room ?? talkRoom}
                  dim={isYourTurn}
                  hold={!!talkFixture}
                  slide={talkFixture?.slide}
                  onSend={talk.send}
                  onOpen={() =>
                    talk.open(
                      typing === 'type' ? 'typing' : talk.line && !talk.offer ? 'log' : 'words'
                    )
                  }
                />
              )}
            </View>
          ) : null}
          {talking ? (
            <TalkSheet
              sheet={talk.sheet}
              log={talk.log}
              who={who}
              onSend={talk.send}
              onOpen={talk.open}
              onReport={(reason) =>
                talk.person ? talk.report(talk.person, reason) : Promise.resolve()
              }
              typing={typing}
              draft={talk.draft}
              onDraft={talk.setDraft}
              onSay={talk.say}
              unread={
                youPositionAbs
                  ? unreadBy(readiness?.seats, youPositionAbs).map(
                      (seat) =>
                        players.find((player) => player.absolutePosition === seat)?.username ??
                        t('social.player')
                    )
                  : []
              }
              onAccount={onSaveGuest}
              onDock={setDock}
            />
          ) : null}
          {!isGameOver && handResult.result ? (
            countHelp ? (
              <HandResultPanel
                key={handResult.result.hand.hand_number}
                result={handResult.result}
                seats={model.seats}
                onClose={handResult.close}
                onContinue={continueHand}
                topReserve={topReserve}
                bottomReserve={bottomReserve}
              />
            ) : (
              <HandPoints
                key={handResult.result.hand.hand_number}
                delta={handResult.result.hand.delta}
                youPosition={youPositionAbs}
                waiting={handResult.result.waiting}
                onContinue={continueHand}
                topReserve={topReserve}
                bottomReserve={bottomReserve}
              />
            )
          ) : null}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              // Beside the menu, out of the felt: the middle is for the cards.
              top: headerTop(insets.top) + PidroSpacing.xxs,
              right: insets.right + PidroLayout.touchTarget + PidroSpacing.lg,
              alignItems: 'center',
            }}>
            <View style={{ alignSelf: 'center' }}>
              <RuleSetChip ruleSet={ruleSet} flagOnly testID="table-rule-set" />
            </View>
          </View>
          <RulesExplainer
            ruleSet={ruleSet}
            tableCode={room.code}
            open={rules.open}
            onClose={rules.dismiss}
          />

          {/* Gold scoreboard plaque (top-left) — matches the original */}
          {!(isGameOver && roomFinished) && (
            <Scoreboard
              scores={tableState?.scores ?? null}
              youPosition={youPositionAbs}
              history={tableState?.hand_history}
              roomCode={viewModel?.roomCode ?? room.code}
              top={headerTop(insets.top)}
              left={insets.left}
              log={handLog}
              resting={resting}
              stateArrived={serverState != null}
              // The log (ticker and the hand's log behind it) is count help.
              // While a hand's result shows, its panel says it all: no ticker.
              ticker={
                countHelp && !handResult.result && !laying
                  ? tickerPlacement(
                      layout,
                      {
                        tableTop: insets.top + topReserve,
                        plaqueLeft: insets.left + PidroSpacing.sm,
                        plaqueTop: headerTop(insets.top),
                      },
                      true
                    )
                  : null
              }
              restingOnly={!fullTicker}
              help={
                lastTrickView ? (
                  <LastTrick trick={lastTrickView} yourTurn={isYourTurn && !laying} />
                ) : null
              }
              // Tight and landscape phones leave the ticker and Last trick out
              // (PID-304, PID-305); the log stays a tap away.
              logInPanel={countHelp && !fullTicker}
              glow={countHelp ? scoreGlow(model.lastTrick, model.seats, trickKey) : null}
              delta={handResult.result?.hand.delta ?? null}
              yourTurn={
                isYourTurn &&
                !laying &&
                (controller.phase === 'bidding' || controller.phase === 'playing')
              }
            />
          )}

          {/* Until this phone has decoded the cards: quiet, in the notice slot, never holding the game. */}
          {loading != null || textures.loading ? (
            <View
              testID="table-loading"
              style={[styles.bannerWrap, reserves.noticeSlot]}
              pointerEvents="none">
              {/* Upright it floats over your seat (PID-393): on the panel the dock gave it. */}
              <View style={!reserves.landscape && styles.noticePanel}>
                <LeagueProgress
                  progress={loading ?? textures.loaded}
                  label={t('game.loading')}
                  width={LOADING_BAR_WIDTH}
                  align="center"
                />
              </View>
            </View>
          ) : null}

          {/* Connection banner, in the notice slot */}
          {isChannelJoined && (
            <TableFeedback
              notice={controller.actionNotice ?? notice ?? null}
              onDismiss={controller.actionNotice ? controller.dismissActionNotice : onDismissNotice}
            />
          )}
          {!isGameOver && (
            <View style={[styles.bannerWrap, reserves.noticeSlot]} pointerEvents="box-none">
              <ConnectionBanner isConnected={isChannelJoined} />
            </View>
          )}

          {!(isGameOver && roomFinished) && (
            <>
              <TableSettings
                onLeave={onLeave}
                isSpectator={isSpectator}
                isSolo={solo}
                isGameOver={isGameOver}
                onRules={rules.show}
              />
              {isSpectator && isChannelJoined && !notice && !controller.actionNotice && (
                <WatchingBadge />
              )}
            </>
          )}

          {/* A dealer picking by hand chooses six here. Everything else of the pick plays out on the table, in no words. */}
          {isSecondDeal && viewModel && canSelectHand && (
            <View
              style={[
                styles.centerOverlay,
                {
                  // Upright phones keep it under North's seat, whatever the cards' size (PID-333).
                  paddingTop:
                    Math.max(
                      insets.top + TABLE_HEADER,
                      layout.profile === 'phone-portrait'
                        ? northSeatBottom(layout, insets.top + topReserve)
                        : 0
                    ) + PidroSpacing.xs,
                  paddingBottom: insets.bottom + 16,
                },
              ]}
              pointerEvents="box-none">
              <DealerSecondDeal
                viewModel={viewModel}
                cards={yourHand}
                trumpSuit={trumpSuit}
                canSelectHand={canSelectHand}
                onSelectHand={handleSelectHand}
              />
            </View>
          )}

          {/* Bidding floats from the bottom; trump is picked in the felt. */}
          <BiddingActions
            isYourTurn={isYourTurn}
            isHandReady={isHandReady && !handResult.result && !laying}
            topReserve={topReserve}
            bottomReserve={bottomReserve}
          />
          {showTrumpSelection && (
            <TrumpPicker
              cards={yourHand ?? []}
              frame={trumpPicker(
                layout,
                insets.top + topReserve,
                insets.top + TABLE_HEADER + PidroSpacing.xs
              )}
              preview={previewSuit}
              onPoint={setPointedSuit}
              onSelect={handleDeclareTrump}
            />
          )}

          {/* Game over */}
          {isGameOver && roomFinished && viewModel && serverState && (
            <GameOverOverlay
              viewModel={viewModel}
              serverState={serverState}
              progressionSummary={progressionSummary}
              leagueProgress={leagueProgress}
              onHome={onHome ?? onLeave}
              onPlayAgain={onPlayAgain ?? onLeave}
              rematch={rematch}
              rematchPending={rematchPending}
              playAgainLabel={playAgainLabel}
              guest={guest}
              showGuestSave={showGuestSave}
              onSaveGuest={onSaveGuest}
              onProfile={openProfile}
            />
          )}
          <PlayerSheet
            {...profile}
            team={sheetSeat ? teamLine(sheetSeat) : null}
            presence={isSpectator ? 'online' : 'table'}
            onClose={() => setProfile({ playerId: null })}
            // Every face at the table opens this one sheet (PID-406); at a talk
            // table its ••• also quiets them or reports what they said.
            talk={
              talking && sheeted
                ? {
                    quiet: talk.quiet.includes(sheeted),
                    onQuiet: () => talk.hush(sheeted),
                    onReport: () => {
                      setProfile({ playerId: null });
                      talk.open('report', sheeted);
                    },
                  }
                : null
            }
          />
        </GestureHandlerRootView>
      </Animated.View>
      {framed ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.frame,
            {
              left: (width - width * fit) / 2 - FRAME_MASK,
              right: (width - width * fit) / 2 - FRAME_MASK,
              top: notch - FRAME_MASK,
              height: dock - PidroSpacing.xs - notch + FRAME_MASK * 2,
            },
            frameStyle,
          ]}
        />
      ) : null}
    </View>
  );
}

const LOADING_BAR_WIDTH = 160;
/** iPad: talk sits beside the hand, a card's width (Chat-iPad). */
const TALK_COLUMN = 182;

/** Wide enough to hide all of the table outside its frame. */
const FRAME_MASK = 240;

const styles = StyleSheet.create({
  // The felt canvas covers it; on Android it would only be painted over.
  // The composer's colour, so a fitted table sits in one frame with it.
  stage: { flex: 1, backgroundColor: PidroBevel.panelMid, overflow: 'hidden' },
  frame: {
    position: 'absolute',
    borderWidth: FRAME_MASK,
    borderRadius: FRAME_MASK + PidroRadii.lg,
    borderColor: PidroBevel.panelMid,
  },
  fitted: { flex: 1, transformOrigin: 'top center' },
  root: { flex: 1, backgroundColor: Platform.OS === 'android' ? undefined : T.bgDeep },
  talk: { position: 'absolute', zIndex: 39, elevation: 39 },
  noticePanel: {
    padding: PidroSpacing.sm,
    borderRadius: PidroRadii.lg,
    backgroundColor: PidroColors.panel,
    borderWidth: 1,
    borderColor: PidroColors.border,
  },
  bannerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 46,
  },
  centerOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
