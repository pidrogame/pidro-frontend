/**
 * Skia game-table screen container. The canvas is the table surface; the existing
 * RN overlays (top bar, connection banner, info bar, bidding, trump, hand-select,
 * game-over) are layered ABOVE it, all driven by the shared controller (M4).
 * NOTE: web loads CanvasKit through the platform-specific loader before this
 * module is imported. Native imports this module directly.
 */
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { BotPersona, RematchVote } from '@pidro/shared';
import type { Room } from '@/types/lobby';
import type { ActiveTurnTimer, Card, RelativePosition, ServerGameState, Suit } from '@/types/game';
import { useGameTableController } from '@/game/useGameTableController';
import { useTableHaptics } from '@/game/useGameHaptics';
import { usePlayGuard } from '@/game/usePlayGuard';
import { useGameStore } from '@/stores/game';
import { ConnectionBanner } from '@/components/ui/ConnectionBanner';
import { TableSettings } from './TableSettings';
import { WatchingBadge } from '@/components/game/WatchingBadge';
import { BiddingActions } from '@/components/game/BiddingActions';
import { TrumpPicker } from '@/components/game/TrumpPicker';
import { DealerSecondDeal } from '@/components/game/DealerSecondDeal';
import { GameOverOverlay } from '@/components/game/GameOverOverlay';
import { PlayerProfileModal } from '@/components/profile/PlayerProfileModal';
import { canViewPlayer } from '@/features/friends';
import { botPersonas } from '@/components/ui/botPersonas';
import { isBuiltinBot } from '@pidro/shared';
import { tableLine } from '@/features/game/tableVoice';
import { pushGameAction, type ProgressionSummary } from '@/channels/hooks/useGameChannel';
import { getRankLabel, SUIT_SYMBOLS } from '@/utils/cards';
import { useCardTextures } from './cardTextures';
import { useTableModel, type TableModel } from './tableModel';
import { useHandPresentationReady } from './useHandPresentationReady';
import { useDealPresentation } from './useDealPresentation';
import { useSecondDealPresentation } from './useSecondDealPresentation';
import { usePlayPresentation } from './usePlayPresentation';
import { T } from './tokens';
import GameCanvas from './GameCanvas';
import { SeatLayer, type SeatTurn } from './SeatLayer';
import type { SeatLine } from '@/features/game/seatLine';
import { SCORE_PLAQUE_HEIGHT, Scoreboard } from './Scoreboard';
import type { TickerRestingLine } from './ActionTicker';
import { buildHandLog } from '@/game/handLog';
import { bidSeatLine, bidsShown } from '@/features/game/bidding';
import { isSoloTable, loneTrumpHolder } from '@/features/game/tableHelp';
import { waitsForContinue } from '@/features/game/handResult';
import { useSettingsStore } from '@/stores/settings';
import { LastTrick, type LastTrickView } from './LastTrick';

import { TABLE_HEADER, TableChromeBars, headerTop, useTableReserves } from './TableChrome';
import { TableSignals, scoreGlow, tablePidro } from './TableSignals';
import { HandResultPanel, useHandResult, viewerOf } from './HandResult';
import { computeLayout, showsTicker, tickerPlacement, trumpPicker, type HeldStyle } from './layout';
import { RuleSetChip } from '@/components/rules/RuleSet';
import { RulesExplainer, useRulesExplainer } from '@/components/rules/RulesExplainer';
import { PidroLayout, PidroSpacing } from '@/design/tokens';
import { t, useTranslation } from '@/i18n';
import { TableFeedback } from '@/components/game/TableFeedback';
import { LeagueProgress } from '@/components/home/LeagueProgress';

type Props = {
  room: Room;
  rulesFixtureSeen?: boolean;
  progressionSummary?: ProgressionSummary | null;
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
  const thinking = isBuiltinBot(player.bot_persona)
    ? t(
        tableLine(
          room,
          state?.hand_number ?? state?.round_number ?? 0,
          botPersonas[player.bot_persona].thinking,
          player.bot_persona
        )
      )
    : null;
  const now = (text: string): SeatLine | null =>
    player.isCurrentTurn ? { text: thinking ?? text, tone: 'now' } : null;

  switch (phase) {
    case 'dealer_selection':
      if (cut) return { text: t('game.draws', { card: cardLabel(cut) }) };
      if (playedCard) return { text: t('game.draws', { card: cardLabel(playedCard) }) };
      return now(t('game.drawing'));
    case 'bidding':
      if (thinking && player.isCurrentTurn) return now(thinking);
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
  players,
  onProfile,
  quiet,
  secondDeal,
  held,
  bid,
}: {
  seats: TableModel['seats'];
  dealerRel: RelativePosition | null;
  dealing: boolean;
  topReserve: number;
  bottomReserve: number;
  statusByRel: Partial<Record<RelativePosition, SeatLine | null>> | undefined;
  players: NonNullable<ReturnType<typeof useGameTableController>['viewModel']>['players'];
  onProfile: (playerId: string | null, persona?: BotPersona | null) => void;
  quiet: boolean;
  secondDeal: ComponentProps<typeof SeatLayer>['secondDeal'];
  held: ComponentProps<typeof SeatLayer>['held'];
  bid: ComponentProps<typeof SeatLayer>['bid'];
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
      turnByRel={turnByRel}
      quiet={quiet}
      secondDeal={secondDeal}
      held={held}
      bid={bid}
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
}: Props) {
  const { locale } = useTranslation();
  const controller = useGameTableController();
  const [profile, setProfile] = useState<
    Pick<ComponentProps<typeof PlayerProfileModal>, 'playerId' | 'persona'>
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
  // A hand scored while watching dims the table until its result closes.
  const handResult = useHandResult(
    controller.serverState ? (controller.serverState.last_hand ?? null) : undefined,
    viewerOf(serverModel.seats),
    room.code,
    waitsForContinue(controller.serverState ?? {})
  );
  // The server sends the next hand with the one that ended: the table holds
  // the hand that ended while its result shows, and deals once it closes.
  const holding = handResult.result != null || handResult.opening;
  const heldModel = useHeldWhile(serverModel, holding);
  // Under the result the hand is played out: no trick, no cards left in hand.
  const tableModel = useMemo(
    () =>
      holding
        ? {
            ...heldModel,
            yourHand: [],
            currentTrick: {},
            playedCards: {},
            latestPlayKey: null,
            winningKey: null,
            trickPoints: null,
          }
        : heldModel,
    [holding, heldModel]
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
  const presented = useSecondDealPresentation(dealt);
  const turnTimer = useGameStore((state) => state.turnTimer);
  const playPresentation = usePlayPresentation(presented, controller.handlePlayCard, turnTimer);
  const model = useMemo(
    () => (held ? { ...playPresentation.model, held } : playPresentation.model),
    [playPresentation.model, held]
  );
  useTableHaptics(model);
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
  const { width, height } = useWindowDimensions();
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

  const playCard = usePlayGuard(playPresentation.playCard, {
    presentation: dealerRobPresentation,
    handReady: isHandReady,
  });

  // Until the deal has played, the log and the seats show no bids (PID-267),
  // also while the last hand's result holds the next hand back.
  const dealing = holding || dealt.dealStage != null;
  const shownState = useMemo(() => bidsShown(serverState, dealing), [serverState, dealing]);

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
    countHelp && controller.phase === 'playing' && lastTrick
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
  const trickKey = `${serverState?.hand_number ?? serverState?.round_number ?? 0}:${model.lastTrick?.number}`;
  const statusByRel = viewModel?.players.reduce(
    (acc, player) => {
      // In the second deal the cards say what happens; only the dealer says it is dealing.
      const line = model.dealStage
        ? model.secondDealShow && player.relativePosition !== model.dealerRelative
          ? null
          : { text: t('game.dealing') }
        : statusText(player, shownState, room.code);
      acc[player.relativePosition] =
        pidro?.side === 'theirs' && pidro.seat === player.relativePosition
          ? { ...(line ?? { text: t('game.took_trick') }), pulse: `pidro-${trickKey}` }
          : line;
      return acc;
    },
    {} as Partial<Record<RelativePosition, SeatLine | null>>
  );
  return (
    <GestureHandlerRootView testID="game-table" style={styles.root}>
      {/* The table surface */}
      <GameCanvas
        model={model}
        textures={textures}
        onPlayCard={playCard}
        topReserve={topReserve}
        bottomReserve={bottomReserve}
        previewSuit={previewSuit}
      />

      {/* Seat furniture (avatars, names, dealer chip, turn rings, opponent backs) over the canvas */}
      <TimedSeatLayer
        seats={model.seats}
        dealerRel={
          controller.phase === 'dealer_selection' ? null : (viewModel?.dealerRelative ?? null)
        }
        dealing={model.dealStage === 'dealing'}
        topReserve={topReserve}
        bottomReserve={bottomReserve}
        statusByRel={statusByRel}
        players={viewModel?.players ?? []}
        onProfile={openProfile}
        quiet={handResult.result != null}
        secondDeal={model.secondDealShow}
        held={model.held}
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
          ].includes(controller.phase ?? '') &&
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

      <TableChromeBars reserves={reserves} />
      {!isGameOver && handResult.result ? (
        <HandResultPanel
          key={handResult.result.hand.hand_number}
          result={handResult.result}
          seats={model.seats}
          onClose={handResult.close}
          onContinue={
            isSpectator
              ? undefined
              : async () => {
                  try {
                    await pushGameAction('continue_hand', {});
                    return true;
                  } catch (error) {
                    controller.showActionError('Continue', error);
                    return false;
                  }
                }
          }
          topReserve={topReserve}
          bottomReserve={bottomReserve}
        />
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
          scores={serverState?.scores ?? null}
          youPosition={youPositionAbs}
          history={serverState?.hand_history}
          roomCode={viewModel?.roomCode ?? room.code}
          top={headerTop(insets.top)}
          left={insets.left}
          log={handLog}
          resting={resting}
          stateArrived={serverState != null}
          // The log (ticker and the hand's log behind it) is count help.
          // While a hand's result shows, its panel says it all: no ticker.
          ticker={
            countHelp && !handResult.result
              ? tickerPlacement(
                  layout,
                  {
                    tableTop: insets.top + topReserve,
                    plaqueLeft: insets.left + PidroSpacing.sm,
                    plaqueTop: headerTop(insets.top),
                    plaqueBottom: headerTop(insets.top) + SCORE_PLAQUE_HEIGHT + PidroSpacing.xxs,
                  },
                  true
                )
              : null
          }
          restingOnly={!fullTicker}
          help={lastTrickView ? <LastTrick trick={lastTrickView} yourTurn={isYourTurn} /> : null}
          glow={countHelp ? scoreGlow(model.lastTrick, model.seats, trickKey) : null}
          delta={handResult.result?.hand.delta ?? null}
          yourTurn={
            isYourTurn && (controller.phase === 'bidding' || controller.phase === 'playing')
          }
        />
      )}

      {/* Until this phone has decoded the cards: quiet, in the notice slot, never holding the game. */}
      {loading != null || textures.loading ? (
        <View
          testID="table-loading"
          style={[styles.bannerWrap, reserves.noticeSlot]}
          pointerEvents="none">
          <LeagueProgress
            progress={loading ?? textures.loaded}
            label={t('game.loading')}
            width={LOADING_BAR_WIDTH}
            align="center"
          />
        </View>
      ) : null}

      {/* Connection banner, in the notice slot */}
      {isChannelJoined && <TableFeedback notice={controller.actionNotice ?? null} />}
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
          {isSpectator && <WatchingBadge />}
        </>
      )}

      {/* A dealer picking by hand chooses six here. Everything else of the pick plays out on the table, in no words. */}
      {isSecondDeal && viewModel && canSelectHand && (
        <View
          style={[
            styles.centerOverlay,
            {
              paddingTop: insets.top + TABLE_HEADER + PidroSpacing.xs,
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
        isHandReady={isHandReady && !handResult.result}
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
      <PlayerProfileModal {...profile} onClose={() => setProfile({ playerId: null })} />
    </GestureHandlerRootView>
  );
}

const LOADING_BAR_WIDTH = 160;

const styles = StyleSheet.create({
  // The felt canvas covers it; on Android it would only be painted over.
  root: { flex: 1, backgroundColor: Platform.OS === 'android' ? undefined : T.bgDeep },
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
