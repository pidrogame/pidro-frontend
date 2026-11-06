/**
 * Presentation-neutral game-table controller (plan §5.1).
 * Reads the stores + view model and exposes derived state + action handlers so
 * both the legacy RN table and the new Skia table render from one source of truth.
 * Logic mirrors the original GameTable derivations exactly. Decides nothing —
 * the server (Phoenix) stays authoritative; handlers send server-intent payloads.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Position } from '@/types/lobby';
import type {
  Card,
  Suit,
  GamePhase,
  LegalAction,
  RelativePosition,
  RelativePlayerView,
  GameViewModel,
  ServerGameState,
} from '@/types/game';
import { useGameStore, useGameViewModel } from '@/stores/game';
import { pushGameAction, sendCard } from '@/channels/hooks/useGameChannel';
import { playActionHaptic } from './useGameHaptics';
import { useTableNotices } from '@/components/game/TableFeedback';
import type { TableNotice } from './tableNotices';
import { blockedPlay } from '@/diagnostics/actions';
import { gameDiagnostics } from '@/diagnostics/buffer';
import { errorPayload } from '@pidro/shared';

export type GameTableController = {
  viewModel: GameViewModel | null;
  serverState: ServerGameState | null;
  youPositionAbs: Position | null;
  isChannelJoined: boolean;
  phase: GamePhase;
  trumpSuit: Suit | null;
  players: RelativePlayerView[];
  currentTurnRelative: RelativePosition | null;
  yourHand: Card[] | null;
  yourCardCount: number | null;
  currentTrick: unknown;
  completedTricks: unknown;
  legalActions: LegalAction[];
  isYourTurn: boolean;
  isPlayingTurn: boolean;
  isDeclaringPhase: boolean;
  showTrumpSelection: boolean;
  isGameOver: boolean;
  isSecondDeal: boolean;
  canSelectHand: boolean;
  isPlayingCard: boolean;
  actionNotice?: TableNotice | null;
  dismissActionNotice?: () => void;
  getCardCountForPlayer: (absPosition: Position | null) => number | null;
  handlePlayCard: (card: Card) => Promise<boolean>;
  handleDeclareTrump: (suit: Suit) => Promise<void> | void;
  handleSelectHand: (cards: Card[]) => Promise<void> | void;
  showActionError: (action: string, err: unknown) => void;
};

export function useGameTableController(): GameTableController {
  const viewModel = useGameViewModel();
  const { serverState, youPositionAbs, isChannelJoined, legalActions, role } = useGameStore(
    useShallow((s) => ({
      serverState: s.serverState,
      youPositionAbs: s.youPositionAbs,
      isChannelJoined: s.isChannelJoined,
      legalActions: s.legalActions,
      role: s.role,
    }))
  );

  const phase = viewModel?.phase ?? 'bidding';
  useEffect(() => {
    if (serverState) gameDiagnostics.rendered(serverState);
  }, [serverState]);
  const trumpSuit = viewModel?.trumpSuit ?? null;
  const players = useMemo(() => viewModel?.players ?? [], [viewModel]);
  const currentTurnRelative = viewModel?.currentTurnRelative ?? null;

  const yourHand = useMemo(() => {
    if (role !== 'player' || !serverState || !youPositionAbs) return null;
    const hand = serverState.players?.[youPositionAbs]?.hand;
    return Array.isArray(hand) ? hand : null;
  }, [serverState, youPositionAbs, role]);

  const yourCardCount = useMemo(() => {
    if (!serverState || !youPositionAbs) return null;
    const view = serverState.players?.[youPositionAbs];
    if (!view) return null;
    const { hand, card_count } = view;
    if (Array.isArray(hand)) return hand.length;
    if (typeof hand === 'number') return hand;
    if (typeof card_count === 'number') return card_count;
    return null;
  }, [serverState, youPositionAbs]);

  const currentTrick = useMemo(() => {
    if (!serverState) return null;
    const trick = (serverState as unknown as Record<string, unknown>).current_trick;
    if (!trick) return null;
    if (typeof trick === 'object' && 'plays' in (trick as object)) {
      return (trick as { plays: unknown }).plays;
    }
    return trick;
  }, [serverState]);

  const completedTricks = useMemo(() => {
    if (!serverState) return null;
    return (serverState as unknown as Record<string, unknown>).tricks ?? null;
  }, [serverState]);

  const getCardCountForPlayer = useCallback(
    (absPosition: Position | null): number | null => {
      if (!absPosition || !serverState?.players) return null;
      const view = serverState.players[absPosition];
      if (!view) return null;
      const { hand, card_count } = view;
      if (typeof hand === 'number') return hand;
      if (Array.isArray(hand)) return hand.length;
      if (typeof card_count === 'number') return card_count;
      return null;
    },
    [serverState]
  );

  const isYourTurn =
    role === 'player' && isChannelJoined && (players.find((p) => p.isYou)?.isCurrentTurn ?? false);
  const isPlayingTurn =
    role === 'player' &&
    (players.find((p) => p.isYou)?.isCurrentTurn ?? false) &&
    phase === 'playing' &&
    legalActions.some((action) => action.type === 'play_card');
  const isDeclaringPhase =
    phase === 'declaring' || phase === 'declaring_trump' || phase === 'trump_declaration';
  const showTrumpSelection =
    isDeclaringPhase &&
    isYourTurn &&
    legalActions.some((action) => action.type === 'declare_trump');
  const isGameOver =
    phase === 'complete' || phase === 'game_over' || (phase as string) === 'finished';
  const isSecondDeal = phase === 'second_deal';
  const canSelectHand =
    role === 'player' &&
    isChannelJoined &&
    isYourTurn &&
    viewModel?.dealerAbsolute === youPositionAbs &&
    legalActions.some((action) => action.type === 'select_hand');

  const [isPlayingCard, setIsPlayingCard] = useState(false);
  const {
    notice: actionNotice,
    addNotice,
    dismissNotice: dismissActionNotice,
  } = useTableNotices(viewModel?.roomCode ?? '');
  const showActionError = useCallback(
    (action: string, err: unknown) => {
      const error = errorPayload(err);
      addNotice(
        error.reason === 'pending'
          ? { key: 'game.tap_wait', variant: 'warning' }
          : {
              error: err,
              key: 'error.action_failed',
              variant:
                (error.error_code ?? error.reason) === 'already_played_for_you'
                  ? 'warning'
                  : 'error',
            }
      );
    },
    [addNotice]
  );

  const handleDeclareTrump = useCallback(
    async (suit: Suit) => {
      try {
        const promise = pushGameAction('declare_trump', { suit });
        if (!promise) return;
        await promise;
        playActionHaptic();
      } catch (error) {
        showActionError('Declare trump', error);
      }
    },
    [showActionError]
  );

  const handlePlayCard = useCallback(
    async (card: Card) => {
      if (isPlayingCard || !isPlayingTurn) {
        blockedPlay(isPlayingCard ? 'pending' : 'not_your_turn');
        if (!isPlayingCard) showActionError('Play card', { reason: 'not_your_turn' });
        return false;
      }
      setIsPlayingCard(true);
      try {
        return await sendCard({ rank: card.rank, suit: card.suit });
      } catch (error) {
        showActionError('Play card', error);
        return false;
      } finally {
        setIsPlayingCard(false);
      }
    },
    [isPlayingCard, isPlayingTurn, showActionError]
  );

  const handleSelectHand = useCallback(
    async (cards: Card[]) => {
      const promise = pushGameAction('select_hand', {
        cards: cards.map((c) => ({ rank: c.rank, suit: c.suit })),
      });
      if (!promise) return;
      try {
        await promise;
        playActionHaptic();
      } catch (error) {
        showActionError('Select hand', error);
      }
    },
    [showActionError]
  );

  return {
    viewModel,
    serverState,
    youPositionAbs,
    isChannelJoined,
    phase,
    trumpSuit,
    players,
    currentTurnRelative,
    yourHand,
    yourCardCount,
    currentTrick,
    completedTricks,
    legalActions,
    isYourTurn,
    isPlayingTurn,
    isDeclaringPhase,
    showTrumpSelection,
    isGameOver,
    isSecondDeal,
    canSelectHand,
    isPlayingCard,
    actionNotice,
    dismissActionNotice,
    getCardCountForPlayer,
    handlePlayCard,
    handleDeclareTrump,
    handleSelectHand,
    showActionError,
  };
}
