import type {
  LegalAction,
  Position,
  ReadinessSnapshot,
  SeatLifecycleSnapshot,
  ServerGameState,
} from '@pidro/shared';
import {
  describeGameAction,
  extractGameState,
  lifecycleFromReply,
  normalizeTurnTimer,
  useGameStore,
} from '@pidro/shared';
import type { Channel } from 'phoenix';
import { Presence } from 'phoenix';
import { useEffect, useRef } from 'react';
import { type ProgressionSummary, parseProgressionSummary } from '../components/profile/postgame';
import { phoenixSocket } from './socket';

export interface SeatEvent {
  message: string;
  variant: 'warning' | 'success' | 'error';
}

let globalGameChannel: Channel | null = null;
let notifySeatEvent: ((event: SeatEvent) => void) | undefined;
let gameRefCount = 0;
let currentTopic: string | null = null;
let isPageUnloading = false;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    isPageUnloading = true;
  });
}

interface UseGameChannelOptions {
  roomCode: string;
  enabled?: boolean;
  onSeatEvent?: (event: SeatEvent) => void;
  onProgressionSummary?: (summary: ProgressionSummary) => void;
}

function seatDisplayName(position: Position | null, fallback?: string | null): string {
  if (fallback) {
    return fallback;
  }

  if (!position) {
    return 'A player';
  }

  return useGameStore.getState().playerMeta[position].username ?? 'A player';
}

function applyLifecycle(
  snapshot: SeatLifecycleSnapshot,
  notify: boolean,
  onSeatEvent?: (event: SeatEvent) => void,
) {
  const before = useGameStore.getState().lifecycle;
  useGameStore.getState().applySeatLifecycle(snapshot);
  if (!notify || useGameStore.getState().lifecycle !== snapshot) return;
  for (const position of ['north', 'east', 'south', 'west'] as Position[]) {
    const previous = before?.seats[position];
    const next = snapshot.seats[position];
    if (!previous || (previous.status === next.status && previous.player_id === next.player_id))
      continue;
    const wasBot = previous.status === 'bot_substitute' || previous.status === 'permanent_bot';
    const isBot = next.status === 'bot_substitute' || next.status === 'permanent_bot';
    const name = isBot
      ? (next.decision?.player_name ?? previous.username ?? 'A player')
      : (next.username ?? 'A player');
    if (isBot && !wasBot && previous.status !== 'vacant')
      onSeatEvent?.({
        message: `${name} (${position}) disconnected. Bot is filling in.`,
        variant: 'warning',
      });
    else if (next.status === 'normal') {
      const action = previous.player_id === next.player_id ? 'is back!' : 'joined the table.';
      onSeatEvent?.({ message: `${name} (${position}) ${action}`, variant: 'success' });
    }
  }
}

export const useGameChannel = ({
  roomCode,
  enabled = true,
  onSeatEvent,
  onProgressionSummary,
}: UseGameChannelOptions) => {
  const setServerState = useGameStore((s) => s.setServerState);
  const setLegalActions = useGameStore((s) => s.setLegalActions);
  const setTurnTimer = useGameStore((s) => s.setTurnTimer);
  const clearTurnTimer = useGameStore((s) => s.clearTurnTimer);
  const setYouPosition = useGameStore((s) => s.setYouPosition);
  const youPosition = useGameStore((s) => s.youPositionAbs);
  const setRole = useGameStore((s) => s.setRole);
  const updateCurrentTurn = useGameStore((s) => s.updateCurrentTurn);
  const setPlayerConnected = useGameStore((s) => s.setPlayerConnected);
  const setSeatStatus = useGameStore((s) => s.setSeatStatus);
  const setReadiness = useGameStore((s) => s.setReadiness);
  const setChannelStatus = useGameStore((s) => s.setChannelStatus);
  const setError = useGameStore((s) => s.setError);

  const onSeatEventRef = useRef(onSeatEvent);
  onSeatEventRef.current = onSeatEvent;

  const onProgressionSummaryRef = useRef(onProgressionSummary);
  onProgressionSummaryRef.current = onProgressionSummary;

  const youPositionRef = useRef(youPosition);
  youPositionRef.current = youPosition;

  useEffect(() => {
    if (!enabled || !roomCode) {
      return;
    }

    gameRefCount++;

    const topic = `game:${roomCode}`;
    let disposed = false;

    const connect = () => {
      if (globalGameChannel && currentTopic && currentTopic !== topic) {
        globalGameChannel.leave();
        globalGameChannel = null;
      }

      if (globalGameChannel) return;

      const channel = phoenixSocket.channel(topic);
      currentTopic = topic;
      let presences: Record<string, unknown> = {};
      const isCurrentChannel = () => !disposed && globalGameChannel === channel;
      const onCurrent = <Payload>(event: string, handler: (payload: Payload) => void) =>
        channel.on(event, (payload) => {
          if (isCurrentChannel()) handler(payload as Payload);
        });

      channel
        .join()
        .receive('ok', (resp: unknown) => {
          if (!isCurrentChannel()) return;
          const response = resp as Record<string, unknown> | undefined;

          setChannelStatus(true, Boolean(response?.reconnected));
          setError(null);
          const role = response?.role as 'player' | 'spectator' | undefined;
          setRole(role ?? null);
          youPositionRef.current = null;
          const lifecycle = lifecycleFromReply(response);
          if (lifecycle) applyLifecycle(lifecycle, false);

          const position = response?.position as Position | undefined;
          if (role === 'player' && position) {
            youPositionRef.current = position;
            setYouPosition(position);
          }

          if (response?.readiness) setReadiness(response.readiness as ReadinessSnapshot);

          const gameState = extractGameState(response);
          if (gameState) {
            setServerState(gameState);
          }

          const legalActions = (response?.legal_actions as LegalAction[] | undefined) ?? [];
          setLegalActions(legalActions);
          setTurnTimer(normalizeTurnTimer(response?.turn_timer));
        })
        .receive('error', (resp) => {
          if (!isCurrentChannel()) return;
          console.error('[GameChannel] Unable to join', topic, resp);
          if (globalGameChannel === channel) {
            globalGameChannel = null;
            currentTopic = null;
          }
          channel.leave();
          setChannelStatus(false);
          clearTurnTimer();
          const reason =
            (resp as { reason?: string } | undefined)?.reason || 'Unable to join game room.';
          setError(reason);
        });

      onCurrent('game_state', (payload: unknown) => {
        const data = payload as Record<string, unknown> | undefined;
        const gameState = extractGameState(data);
        if (gameState) {
          const legalActions = (data?.legal_actions as LegalAction[] | undefined) ?? [];
          setServerState(gameState);
          setLegalActions(legalActions);
        }
      });

      onCurrent('seat_lifecycle', (payload: unknown) => {
        const snapshot = lifecycleFromReply(payload);
        if (snapshot) applyLifecycle(snapshot, true, onSeatEventRef.current);
      });

      onCurrent('game_over', (payload: unknown) => {
        const data = payload as Record<string, unknown> | undefined;
        const winner =
          data?.winner === 'north_south' || data?.winner === 'east_west' ? data.winner : null;
        const scores = data?.scores as ServerGameState['scores'] | undefined;
        const currentState = useGameStore.getState().serverState;
        if (!currentState) return;

        setServerState({
          ...currentState,
          phase: 'game_over',
          winner,
          ...(scores ? { scores } : {}),
        });
      });

      onCurrent('turn_timer_started', (payload: unknown) => {
        setTurnTimer(normalizeTurnTimer(payload));
      });

      onCurrent('turn_timer_cancelled', (payload: unknown) => {
        const data = payload as { timer_id?: number } | undefined;
        clearTurnTimer(data?.timer_id ?? null);
      });

      onCurrent('turn_auto_played', (payload: unknown) => {
        const data = payload as Record<string, unknown> | undefined;
        const scope = data?.scope;
        const position = (data?.position as Position | null | undefined) ?? null;
        const action = data?.action as Record<string, unknown> | undefined;

        if (scope === 'room') {
          onSeatEventRef.current?.({
            message: `Dealer selection timed out. The server ${describeGameAction(action)}.`,
            variant: 'warning',
          });
          return;
        }

        if (position && position === youPositionRef.current) {
          onSeatEventRef.current?.({
            message: `Time expired. The server ${describeGameAction(action)} for you.`,
            variant: 'warning',
          });
        }
      });

      onCurrent('force_disconnect', () => {
        clearTurnTimer();
        setRole(null);
        setChannelStatus(false, false);
        setError(
          'Disconnected for inactivity after repeated turn timeouts. Retry to rejoin when ready.',
        );
      });

      onCurrent('turn_changed', (payload: unknown) => {
        const data = payload as Record<string, unknown> | undefined;
        const pos: Position | null =
          (data?.position as Position) ||
          (data?.current_player as Position) ||
          (data?.current_turn as Position) ||
          null;
        updateCurrentTurn(pos);
      });

      onCurrent('presence_state', (state: object) => {
        if (useGameStore.getState().lifecycle) return;
        presences = Presence.syncState(presences, state);
        const entries = Presence.list(presences, (id, { metas }) => ({
          id,
          position: (metas[0] as Record<string, unknown> | undefined)?.position as Position | null,
        }));
        for (const { id, position } of entries) {
          setPlayerConnected(id, position, true);
        }
      });

      onCurrent('presence_diff', (diff: { joins: object; leaves: object }) => {
        if (useGameStore.getState().lifecycle) return;
        presences = Presence.syncDiff(presences, diff);

        const diffTyped = diff as {
          leaves?: Record<string, { metas: Record<string, unknown>[] }>;
          joins?: Record<string, { metas: Record<string, unknown>[] }>;
        };
        for (const [playerId, value] of Object.entries(diffTyped.leaves || {})) {
          const meta = value?.metas?.[0];
          const position = (meta?.position as Position) || null;
          setPlayerConnected(playerId, position, false);
        }
        for (const [playerId, value] of Object.entries(diffTyped.joins || {})) {
          const meta = value?.metas?.[0];
          const position = (meta?.position as Position) || null;
          setPlayerConnected(playerId, position, true);
        }
      });

      onCurrent('player_disconnected', (payload: unknown) => {
        if (useGameStore.getState().lifecycle) return;
        const data = payload as Record<string, unknown> | undefined;
        const playerId = (data?.user_id as string) || null;
        const position = (data?.position as Position) || null;
        setPlayerConnected(playerId, position, false);
      });

      onCurrent('player_reconnected', (payload: unknown) => {
        if (useGameStore.getState().lifecycle) return;
        const data = payload as Record<string, unknown> | undefined;
        const playerId = (data?.user_id as string) || null;
        const position = (data?.position as Position) || null;
        if (position) {
          setSeatStatus(position, 'normal');
        }
        setPlayerConnected(playerId, position, true);
      });

      onCurrent('readiness_updated', (snapshot: ReadinessSnapshot) => {
        if (globalGameChannel === channel) setReadiness(snapshot);
      });

      onCurrent('player_reconnecting', (payload: unknown) => {
        if (useGameStore.getState().lifecycle) return;
        const data = payload as Record<string, unknown> | undefined;
        const position = (data?.position as Position) || null;
        if (position) {
          setPlayerConnected(null, position, false);
          setSeatStatus(position, 'reconnecting');
        }
      });

      onCurrent('bot_substitute_active', (payload: unknown) => {
        if (useGameStore.getState().lifecycle) return;
        const data = payload as Record<string, unknown> | undefined;
        const position = (data?.position as Position) || null;
        const username = (data?.username as string) || (data?.player_name as string) || null;
        if (position) {
          setSeatStatus(position, 'bot_substitute', username);
          setPlayerConnected(null, position, true);
          onSeatEventRef.current?.({
            message: `${seatDisplayName(position, username)} disconnected. Bot is filling in.`,
            variant: 'warning',
          });
        }
      });

      onCurrent('player_reclaimed_seat', (payload: unknown) => {
        if (useGameStore.getState().lifecycle) return;
        const data = payload as Record<string, unknown> | undefined;
        const position = (data?.position as Position) || null;
        const username = (data?.username as string) || (data?.player_name as string) || null;
        if (position) {
          setSeatStatus(position, 'normal', username);
          setPlayerConnected(null, position, true);
          onSeatEventRef.current?.({
            message: `${seatDisplayName(position, username)} is back!`,
            variant: 'success',
          });
        }
      });

      onCurrent('seat_permanently_botted', (payload: unknown) => {
        if (useGameStore.getState().lifecycle) return;
        const data = payload as Record<string, unknown> | undefined;
        const position = (data?.position as Position) || null;
        if (position) {
          setSeatStatus(position, 'permanent_bot');
          setPlayerConnected(null, position, true);
        }
      });

      onCurrent('substitute_available', (payload: unknown) => {
        if (useGameStore.getState().lifecycle) return;
        const data = payload as Record<string, unknown> | undefined;
        const position = (data?.position as Position) || null;
        if (position) {
          setSeatStatus(position, 'vacant');
          setPlayerConnected(null, position, false);
        }
      });

      onCurrent('substitute_seat_closed', (payload: unknown) => {
        if (useGameStore.getState().lifecycle) return;
        const data = payload as Record<string, unknown> | undefined;
        const position = (data?.position as Position) || null;
        if (position) {
          setSeatStatus(position, 'permanent_bot');
          setPlayerConnected(null, position, true);
        }
      });

      onCurrent('substitute_joined', (payload: unknown) => {
        if (useGameStore.getState().lifecycle) return;
        const data = payload as Record<string, unknown> | undefined;
        const position = (data?.position as Position) || null;
        const username = (data?.username as string) || (data?.player_name as string) || null;
        if (position) {
          setSeatStatus(position, 'normal', username ?? null);
          setPlayerConnected(null, position, true);
          onSeatEventRef.current?.({
            message: `${username ?? 'A new player'} joined as substitute`,
            variant: 'success',
          });
        }
      });

      onCurrent('progression_summary', (payload: unknown) => {
        const summary = parseProgressionSummary(payload);
        if (summary) onProgressionSummaryRef.current?.(summary);
      });

      channel.onError(() => {
        if (!isCurrentChannel()) return;
        setChannelStatus(false, true);
      });

      channel.onClose(() => {
        if (!isCurrentChannel()) return;
        if (globalGameChannel === channel) {
          globalGameChannel = null;
          currentTopic = null;
        }
        setChannelStatus(false, false);
        // Keep the last confirmed read-only role visible while reconnecting.
        setRole(useGameStore.getState().role === 'spectator' ? 'spectator' : null);
      });

      globalGameChannel = channel;
      notifySeatEvent = (event) => onSeatEventRef.current?.(event);
    };

    connect();

    return () => {
      disposed = true;
      gameRefCount--;
      if (gameRefCount === 0 && globalGameChannel) {
        // During page refresh/unload, don't explicitly leave — let the socket
        // drop naturally so the backend treats it as a disconnect (with
        // reconnection window) rather than an intentional leave.
        if (!isPageUnloading) {
          globalGameChannel.leave();
        }
        globalGameChannel = null;
        notifySeatEvent = undefined;
        currentTopic = null;
      }
    };
  }, [
    roomCode,
    enabled,
    setServerState,
    setLegalActions,
    setTurnTimer,
    clearTurnTimer,
    setYouPosition,
    setRole,
    updateCurrentTurn,
    setPlayerConnected,
    setSeatStatus,
    setReadiness,
    setChannelStatus,
    setError,
  ]);
};

export function pushGameAction(event: string, payload: object) {
  const channel = globalGameChannel;
  if (!channel || channel.state !== 'joined') {
    return Promise.reject(new Error('No active game channel'));
  }
  if (event !== 'get_seat_lifecycle' && useGameStore.getState().role !== 'player') {
    return Promise.reject(new Error('Watching is read-only'));
  }

  return new Promise<void>((resolve, reject) => {
    channel
      .push(event, payload)
      .receive('ok', (response: { readiness?: ReadinessSnapshot }) => {
        const snapshot = lifecycleFromReply(response);
        if (snapshot && globalGameChannel === channel)
          applyLifecycle(snapshot, true, notifySeatEvent);
        if (globalGameChannel === channel && response?.readiness)
          useGameStore.getState().setReadiness(response.readiness);
        resolve();
      })
      .receive('error', (error: { readiness?: ReadinessSnapshot }) => {
        const snapshot = lifecycleFromReply(error);
        if (snapshot && globalGameChannel === channel)
          applyLifecycle(snapshot, true, notifySeatEvent);
        if (globalGameChannel === channel && error?.readiness)
          useGameStore.getState().setReadiness(error.readiness);
        reject(error);
      })
      .receive('timeout', () => reject(new Error('Request timed out')));
  });
}

export function refreshSeatLifecycle(): Promise<void> {
  return pushGameAction('get_seat_lifecycle', {});
}
