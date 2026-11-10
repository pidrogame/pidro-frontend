import { lifecycleFromReply, publicPlayerName } from '@pidro/shared';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Channel, Presence } from 'phoenix';
import {
  extractGamePresentation,
  extractGameState,
  normalizeTurnTimer,
  shouldAutoSelectDealer,
  type ReadinessSnapshot,
  type SeatLifecycleSnapshot,
} from '@pidro/shared';
import { batchedUpdates as unstable_batchedUpdates } from '@/utils/batchedUpdates';
import { phoenixSocket } from '../socket';
import { initRealtime } from '@/bootstrap/realtime';
import { useGameStore } from '@/stores/game';
import type { Card, LegalAction, ServerGameState } from '@/types/game';
import type { Position } from '@/types/lobby';
import { waitingRoomEvent, type WaitingRoomEvent } from '../gameRoomEvents';
import { terminalGameJoinFailure } from '../gameJoinFailure';
import { reconnectsAfterClose } from '@/features/game/channelReconnect';
import type { TableNotice } from '@/game/tableNotices';
import { useSettingsStore } from '@/stores/settings';
import { isSoloTable } from '@/features/game/tableHelp';
import { authStore } from '@/stores/auth';
import { diagnosticAction, diagnosticCode, gameDiagnostics } from '@/diagnostics/buffer';
import { pushAttempt } from '@/diagnostics/actions';
import { diagnosticMetadata } from '@/diagnostics/metadata';
import { pendingPlay } from '@/features/game/pendingPlay';
import { awayPlays } from '@/features/game/awayPlays';
import { randomUUID } from '@/diagnostics/uuid';
import { heard, mergeTalk, saidFrom, type Said } from '@/features/game/talk';

let globalGameChannel: Channel | null = null;
let pendingCard: ReturnType<typeof pendingPlay> | null = null;
/** Your last card sent and the state it left, unless the server refused it. */
let sentCard: { card: Card; from: ServerGameState } | null = null;
/** Cards a "Time ran out" notice named that no state has shown yet. */
let toldCards: Card[] = [];
let notifySeatEvent: ((event: SeatEvent) => void) | undefined;
let gameRefCount = 0;
let currentTopic: string | null = null;
const talkListeners = new Set<(event: 'talk' | 'moment', payload: unknown) => void>();

/** Table talk (PID-114) and the moments it answers (PID-328): the table listens while it shows. */
export function onTableTalk(listener: (event: 'talk' | 'moment', payload: unknown) => void) {
  talkListeners.add(listener);
  return () => {
    talkListeners.delete(listener);
  };
}

/**
 * The room's talk (PID-418), oldest first: the join reply's replay, then every line
 * since. The waiting room and the table's log both read it, so neither loses a line
 * at the handover and a rejoin adds only what it missed. What they show starts at
 * `from`: where the room is now, waiting (null) or a game, decides it.
 */
interface RoomTalk {
  topic: string | null;
  lines: Said[];
  from: number;
  at?: string | null;
}
const NO_TALK: RoomTalk = { topic: null, lines: [], from: 0 };
let roomTalk = NO_TALK;
const talkReaders = new Set<() => void>();

function setRoomTalk(next: RoomTalk) {
  roomTalk = next;
  talkReaders.forEach((read) => read());
}

/**
 * The first game keeps what was said while the table filled; after a game, the
 * next waiting room or rematch starts clean. A remount at the same place changes nothing.
 */
export function talkAt(at: string | null) {
  if (roomTalk.at === at) return;
  const ended = typeof roomTalk.at === 'string';
  setRoomTalk({ ...roomTalk, at, from: ended ? roomTalk.lines.length : roomTalk.from });
}

/** A replay is the room's whole talk until it fills the server's window. */
const REPLAY_WINDOW = 20;

const readTalk = (read: () => void) => {
  talkReaders.add(read);
  return () => {
    talkReaders.delete(read);
  };
};

export function useRoomTalk(): Said[] {
  const talk = useSyncExternalStore(readTalk, () => roomTalk);
  return useMemo(() => talk.lines.slice(talk.from), [talk]);
}

interface UseGameChannelOptions {
  roomCode: string;
  enabled?: boolean;
  onSeatEvent?: (event: SeatEvent) => void;
  onProgressionSummary?: (summary: ProgressionSummary) => void;
  onWaitingRoomEvent?: (event: WaitingRoomEvent) => void;
}

export type SeatEvent = TableNotice;

export interface ProgressionSummary {
  rated: boolean;
  xp_earned: number;
  veteran_xp: number;
  veteran_level_before: number;
  veteran_level: number;
  leveled_up: boolean;
  veteran_title_before: string;
  veteran_title: string;
  title_changed: boolean;
  veteran_progress: { into: number; span: number; max: boolean };
  achievements_unlocked: { key: string; name: string; tier: number }[];
  /** Null for a bot or guest partner (PID-234). */
  partner?: {
    user_id: string;
    display_name: string;
    games_together: number;
    wins_in_a_row: number;
  } | null;
  rating: {
    tier_before: string;
    tier_after: string;
    provisional_before: boolean;
    provisional_after: boolean;
    direction: 'up' | 'down' | 'none';
  } | null;
}

function seatDisplayName(position: Position | null, fallback?: string | null): string | undefined {
  if (fallback) return fallback;
  if (!position) return undefined;
  return useGameStore.getState().playerMeta[position].username ?? undefined;
}

function applyLifecycle(
  snapshot: SeatLifecycleSnapshot,
  notify: boolean,
  onSeatEvent?: (event: SeatEvent) => void
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
      ? (next.decision?.player_name ?? previous.username)
      : publicPlayerName(next.username, '', next.display_name);
    if (isBot && !wasBot && previous.status !== 'vacant') {
      onSeatEvent?.({
        key: 'game.notice_disconnected_seat',
        seat: { name, position },
        variant: 'warning',
      });
    } else if (next.status === 'normal') {
      onSeatEvent?.({
        key:
          previous.player_id === next.player_id
            ? 'game.notice_back_seat'
            : 'game.notice_joined_seat',
        seat: { name, position },
        variant: 'success',
      });
    }
  }
}

function parseProgressionSummary(payload: unknown): ProgressionSummary | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  if (typeof data.veteran_level !== 'number' || typeof data.xp_earned !== 'number') return null;
  return data as unknown as ProgressionSummary;
}

export const useGameChannel = ({
  roomCode,
  enabled = true,
  onSeatEvent,
  onProgressionSummary,
  onWaitingRoomEvent,
}: UseGameChannelOptions) => {
  const setServerState = useGameStore((s) => s.setServerState);
  const setPresentation = useGameStore((s) => s.setPresentation);
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
  const setAway = useGameStore((s) => s.setAway);
  const away = useGameStore((s) => s.isAway);
  const joined = useGameStore((s) => s.isChannelJoined);
  const solo = useGameStore(
    (s) => s.role === 'player' && isSoloTable(s.readiness, s.youPositionAbs)
  );
  const supportsPace = useGameStore((s) => s.serverState?.pace != null);
  const pace = useSettingsStore((s) => s.pace);
  const settingsHydrated = useSettingsStore((s) => s.hydrated);

  useEffect(() => {
    if (!enabled || !joined || !solo || !settingsHydrated || !supportsPace) return;
    // Older channels cannot handle this intent; wait for the server to advertise pace.
    void pushGameAction('set_pace', { pace }).catch(() => {});
  }, [enabled, joined, solo, settingsHydrated, supportsPace, pace, roomCode]);

  const onSeatEventRef = useRef(onSeatEvent);
  const onProgressionSummaryRef = useRef(onProgressionSummary);
  const onWaitingRoomEventRef = useRef(onWaitingRoomEvent);
  const youPositionRef = useRef(youPosition);

  useEffect(() => {
    onSeatEventRef.current = onSeatEvent;
    onProgressionSummaryRef.current = onProgressionSummary;
    onWaitingRoomEventRef.current = onWaitingRoomEvent;
    youPositionRef.current = youPosition;
  }, [onProgressionSummary, onSeatEvent, onWaitingRoomEvent, youPosition]);

  useEffect(() => {
    initRealtime();

    // Don't connect if not enabled (e.g., game not started yet), or while the
    // player is away until they say they are back.
    if (!enabled || away || !roomCode) {
      return;
    }

    gameRefCount++;

    const topic = `game:${roomCode}`;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (globalGameChannel && currentTopic && currentTopic !== topic) {
        pendingCard?.cancel();
        pendingCard = null;
        globalGameChannel.leave();
        globalGameChannel = null;
      }

      if (globalGameChannel) return;

      const channelOwner = authStore.getState().user?.id ?? null;
      gameDiagnostics.identify(channelOwner, roomCode);
      const connectionParams = phoenixSocket.connectionParams();
      const channel = phoenixSocket.channel(topic, () => ({
        app_version: diagnosticMetadata.app_version,
        app_build: diagnosticMetadata.build,
        platform: diagnosticMetadata.platform,
        ...connectionParams(),
      }));
      currentTopic = topic;
      // Another room's talk is not this one's.
      if (roomTalk.topic !== topic) setRoomTalk({ ...NO_TALK, topic });
      let presences: Record<string, unknown> = {};
      let dealerSelectionRequestKey: string | null = null;
      const isCurrentChannel = () => !disposed && globalGameChannel === channel;
      const observed = (state: ServerGameState) => {
        if (authStore.getState().user?.id !== channelOwner) return;
        gameDiagnostics.identify(channelOwner, roomCode);
        gameDiagnostics.observe(state);
        // No optional state_received push: old servers already send cursors but
        // crash their channel on that unknown event. Await capability negotiation.
      };
      const onCurrent = <Payload>(event: string, handler: (payload: Payload) => void) =>
        channel.on(event, (payload) => {
          if (isCurrentChannel()) handler(payload as Payload);
        });

      const maybeAutoSelectDealer = (
        gameState: ServerGameState,
        legalActions: LegalAction[],
        position: Position | null
      ) => {
        if (useGameStore.getState().role !== 'player') return;
        if (!shouldAutoSelectDealer(gameState, legalActions, position)) return;

        const handNumber =
          typeof gameState.hand_number === 'number' ? gameState.hand_number : 'initial';
        const key = `${roomCode}:${handNumber}`;
        if (dealerSelectionRequestKey === key) return;

        dealerSelectionRequestKey = key;
        void pushGameAction('select_dealer', {}).catch((error) => {
          if (error?.reason === 'timeout') dealerSelectionRequestKey = null;
        });
      };

      channel
        .join()
        .receive('ok', (resp: unknown) => {
          if (disposed || globalGameChannel !== channel) return;
          const response = resp as Record<string, unknown> | undefined;
          let away: ReturnType<typeof awayPlays> = null;

          // Batch all state updates to avoid navigation context issues
          unstable_batchedUpdates(() => {
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
            if (Array.isArray(response?.talk)) {
              const replay = response.talk.flatMap((payload) => saidFrom(payload) ?? []);
              const { lines, from } = roomTalk;
              const merged = mergeTalk(lines, replay, replay.length < REPLAY_WINDOW);
              // This game's lines stay this game's, however many older ones the replay changed.
              const kept = Math.max(0, merged.length - (lines.length - from));
              setRoomTalk({ ...roomTalk, lines: merged, from: Math.min(from, kept) });
            }
            const gameState = extractGameState(response);
            if (gameState) {
              // Back after a drop: say what the table played from your hand meanwhile.
              const before = useGameStore.getState().serverState;
              const sent =
                sentCard &&
                sentCard.from.hand_number === before?.hand_number &&
                sentCard.from.game_instance_id === before?.game_instance_id
                  ? [sentCard.card]
                  : [];
              away =
                before && role === 'player' && position
                  ? awayPlays(before, gameState, position, { tapped: sent, told: toldCards })
                  : null;
              toldCards = [];
              setServerState(gameState);
              observed(gameState);
            }
            // A rejoin summary belongs to the state in this reply, not the previous game.
            const summary = parseProgressionSummary(response?.progression_summary);
            if (summary) onProgressionSummaryRef.current?.(summary);
            gameDiagnostics.record({ type: 'connection', code: 'connected', action: 'join' });
            setPresentation(extractGamePresentation(response));

            const legalActions = (response?.legal_actions as LegalAction[] | undefined) ?? [];
            setLegalActions(legalActions);
            setTurnTimer(normalizeTurnTimer(response?.turn_timer));

            if (gameState) {
              maybeAutoSelectDealer(gameState, legalActions, position ?? youPositionRef.current);
            }
          });
          if (away) {
            onSeatEventRef.current?.({ away, variant: 'warning' });
            // A card played for you settled that turn; the notice says so, the tap stays quiet.
            pendingCard?.cancel();
          }
          if (useGameStore.getState().role !== 'player') pendingCard?.cancel();
          else {
            const state = useGameStore.getState().serverState;
            if (state) pendingCard?.observe(state);
            pendingCard?.rejoin();
          }
        })
        .receive('error', (resp) => {
          if (disposed || globalGameChannel !== channel) return;
          gameDiagnostics.record({ type: 'connection', code: 'failed', action: 'join' });
          console.error('[GameChannel] Unable to join', topic, resp);
          const reason =
            (resp as { reason?: string } | undefined)?.reason || 'Unable to join game room.';

          if (terminalGameJoinFailure(reason)) {
            pendingCard?.cancel();
            pendingCard = null;
            // A rejected seat or room cannot recover through another Phoenix
            // rejoin. Detach first so leave() cannot make onClose schedule the
            // hook's replacement channel.
            if (reconnectTimer) {
              clearTimeout(reconnectTimer);
              reconnectTimer = null;
            }
            globalGameChannel = null;
            currentTopic = null;
            notifySeatEvent = undefined;
            setChannelStatus(false, false);
            clearTurnTimer();
            setLegalActions([]);
            setRole(null);
            setError(reason);
            channel.leave();
            return;
          }

          // Phoenix keeps retrying transient join failures with backoff.
          setChannelStatus(false, true);
          clearTurnTimer();
          setError(reason);
        });

      onCurrent('game_state', (payload: unknown) => {
        if (disposed || globalGameChannel !== channel) return;
        const data = payload as Record<string, unknown> | undefined;
        const gameState = extractGameState(data);
        if (gameState) {
          const legalActions = (data?.legal_actions as LegalAction[] | undefined) ?? [];
          toldCards = [];
          unstable_batchedUpdates(() => {
            setServerState(gameState);
            observed(gameState);
            setPresentation(extractGamePresentation(data));
            setLegalActions(legalActions);
            maybeAutoSelectDealer(gameState, legalActions, youPositionRef.current);
          });
          const state = useGameStore.getState().serverState;
          if (state) pendingCard?.observe(state);
        } else {
          console.warn('[GameChannel] Invalid game_state payload', payload);
        }
      });

      onCurrent('seat_lifecycle', (payload: unknown) => {
        const snapshot = lifecycleFromReply(payload);
        if (snapshot) applyLifecycle(snapshot, true, onSeatEventRef.current);
      });

      onCurrent('game_over', (payload: unknown) => {
        if (disposed || globalGameChannel !== channel) return;
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
            autoTurn: { scope: 'room', action },
            variant: 'warning',
          });
          return;
        }

        if (position && position === youPositionRef.current) {
          const card = action?.type === 'play_card' ? (action.card as Card | undefined) : undefined;
          if (card) toldCards.push(card);
          onSeatEventRef.current?.({
            autoTurn: { scope: 'you', action },
            variant: 'warning',
          });
        }
      });

      onCurrent('force_disconnect', () => {
        clearTurnTimer();
        setRole(null);
        setChannelStatus(false, false);
        setAway(true);
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
        entries.forEach(({ id, position }) => setPlayerConnected(id, position, true));
      });

      onCurrent('presence_diff', (diff: { joins: object; leaves: object }) => {
        if (useGameStore.getState().lifecycle) return;
        presences = Presence.syncDiff(presences, diff);

        const diffTyped = diff as {
          leaves?: Record<string, { metas?: Record<string, unknown>[] }>;
          joins?: Record<string, { metas?: Record<string, unknown>[] }>;
        };
        Object.entries(diffTyped.leaves || {}).forEach(([playerId, value]) => {
          const meta = value?.metas?.[0];
          const position = (meta?.position as Position) || null;
          setPlayerConnected(playerId, position, false);
        });
        Object.entries(diffTyped.joins || {}).forEach(([playerId, value]) => {
          const meta = value?.metas?.[0];
          const position = (meta?.position as Position) || null;
          setPlayerConnected(playerId, position, true);
        });
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

      onCurrent('readiness_updated', setReadiness);

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
        const username =
          publicPlayerName(data?.username ?? data?.player_name, '', data?.display_name) ||
          undefined;
        if (position) {
          setSeatStatus(position, 'bot_substitute', username);
          setPlayerConnected(null, position, true);
          onSeatEventRef.current?.({
            key: 'game.notice_disconnected',
            seat: { name: seatDisplayName(position, username) },
            variant: 'warning',
          });
        }
      });

      onCurrent('player_reclaimed_seat', (payload: unknown) => {
        if (useGameStore.getState().lifecycle) return;
        const data = payload as Record<string, unknown> | undefined;
        const position = (data?.position as Position) || null;
        const username =
          publicPlayerName(data?.username ?? data?.player_name, '', data?.display_name) ||
          undefined;
        if (position) {
          setSeatStatus(position, 'normal', username);
          setPlayerConnected(null, position, true);
          onSeatEventRef.current?.({
            key: 'game.notice_back',
            seat: { name: seatDisplayName(position, username) },
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
        const username =
          publicPlayerName(data?.username ?? data?.player_name, '', data?.display_name) ||
          undefined;
        if (position) {
          setSeatStatus(position, 'normal', username);
          setPlayerConnected(null, position, true);
          onSeatEventRef.current?.({
            key: 'game.notice_substitute',
            seat: { name: username },
            variant: 'success',
          });
        }
      });

      for (const event of [
        'invite_redeemed',
        'player_kicked',
        'seat_moved',
        'owner_changed',
        'kicked',
        'seat_invitation_declined',
      ]) {
        onCurrent(event, (payload: unknown) => {
          const mapped = waitingRoomEvent(event, payload);
          if (mapped) onWaitingRoomEventRef.current?.(mapped);
          else console.warn(`[GameChannel] Dropped malformed ${event}`);
        });
      }

      onCurrent('talk', (payload: unknown) => {
        const said = saidFrom(payload);
        // The same line again (in the join reply, or live twice after a reconnect) is not news.
        if (said && heard(roomTalk.lines, said)) return;
        if (said) setRoomTalk({ ...roomTalk, lines: [...roomTalk.lines, said] });
        talkListeners.forEach((listener) => listener('talk', payload));
      });

      onCurrent('moment', (payload: unknown) => {
        talkListeners.forEach((listener) => listener('moment', payload));
      });

      onCurrent('progression_summary', (payload: unknown) => {
        const summary = parseProgressionSummary(payload);
        if (summary) onProgressionSummaryRef.current?.(summary);
      });

      channel.onError((reason) => {
        if (disposed || globalGameChannel !== channel) return;
        gameDiagnostics.record({ type: 'connection', code: 'reconnecting', action: 'reconnect' });
        console.warn('[GameChannel] Error', reason);
        setChannelStatus(false, true);
      });

      channel.onClose(() => {
        const wasActive = globalGameChannel === channel;
        if (disposed || !wasActive) return;
        gameDiagnostics.record({ type: 'connection', code: 'disconnected', action: 'reconnect' });
        globalGameChannel = null;
        currentTopic = null;
        setChannelStatus(false, false);
        // Keep the last confirmed seat and hand so a tap can wait for rejoin.
        // An unexpected close (socket drop, server restart) leaves no channel
        // behind and nothing re-runs the effect — reconnect ourselves while a
        // screen still needs this topic. Intentional leave() sets refCount 0,
        // and a player the server removed for missed turns stays away.
        if (reconnectsAfterClose(useGameStore.getState().isAway, gameRefCount)) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (!disposed && gameRefCount > 0 && !globalGameChannel) {
              connect();
            }
          }, 1200);
        }
      });

      globalGameChannel = channel;
      notifySeatEvent = (event) => onSeatEventRef.current?.(event);
      onCurrent('ping', ({ id }: { id: string }) => {
        channel.push('pong', { id });
      });
      phoenixSocket.beforeBackground = (done) => {
        if (
          isCurrentChannel() &&
          channel.state === 'joined' &&
          useGameStore.getState().role === 'player'
        )
          channel
            .push('going_background', {}, 500)
            .receive('ok', done)
            .receive('error', done)
            .receive('timeout', done);
        else done();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      gameRefCount--;
      if (gameRefCount === 0) {
        pendingCard?.cancel();
        pendingCard = null;
        phoenixSocket.beforeBackground = undefined;
        gameDiagnostics.record({ type: 'connection', code: 'disconnected', action: 'leave' });
        globalGameChannel?.leave();
        globalGameChannel = null;
        notifySeatEvent = undefined;
        currentTopic = null;
        setRoomTalk(NO_TALK);
      }
    };
  }, [
    roomCode,
    enabled,
    away,
    setServerState,
    setPresentation,
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
    setAway,
  ]);
};

export function sendCard(card: Card): Promise<boolean> {
  if (pendingCard) return pendingCard.promise;
  const { serverState, youPositionAbs, role, turnTimer } = useGameStore.getState();
  if (!serverState || !youPositionAbs || role !== 'player') return Promise.resolve(false);
  const attempt = pushAttempt('play_card');
  const actionId = attempt.id ?? randomUUID();
  const payload = {
    card,
    game_instance_id: serverState.game_instance_id,
    turn_event_seq: serverState.turn_event_seq ?? turnTimer?.eventSeq,
  };
  const intent = pendingPlay({
    card,
    position: youPositionAbs,
    state: serverState,
    send: () => pushGameAction('play_card', payload, actionId),
  });
  pendingCard = intent;
  const sent = { card, from: serverState };
  sentCard = sent;
  intent.rejoin();
  return intent.promise
    .catch((error) => {
      // Refused or too late: the table did not take this card from you.
      if (sentCard === sent) sentCard = null;
      throw error;
    })
    .finally(() => {
      if (pendingCard === intent) pendingCard = null;
    });
}

export function pushGameAction(event: string, payload: object, actionId?: string) {
  const channel = globalGameChannel as (Channel & { joinRef(): string }) | null;
  const attempt = actionId
    ? { id: actionId, record: gameDiagnostics.attempt(diagnosticAction(event), actionId) }
    : pushAttempt(event);
  if (!channel || channel.state !== 'joined') {
    attempt.record('blocked', 'disconnected');
    console.warn('[GameChannel] Cannot push, no active channel');
    return Promise.reject({ reason: 'disconnected' });
  }
  if (event !== 'get_seat_lifecycle' && useGameStore.getState().role !== 'player') {
    attempt.record('blocked', 'unavailable');
    return Promise.reject(new Error('Watching is read-only'));
  }

  attempt.record('push', 'pending');
  const joinRef = channel.joinRef();
  return new Promise<void>((resolve, reject) => {
    channel
      .push(
        event,
        { ...payload, ...((actionId ?? attempt.id) ? { action_id: actionId ?? attempt.id } : {}) },
        event === 'play_card' ? 4000 : 10000
      )
      .receive('ok', (response: { readiness?: ReadinessSnapshot }) => {
        attempt.record('push', 'ok');
        const snapshot = lifecycleFromReply(response);
        if (snapshot && globalGameChannel === channel)
          applyLifecycle(snapshot, true, notifySeatEvent);
        if (globalGameChannel === channel && response?.readiness)
          useGameStore.getState().setReadiness(response.readiness);
        resolve();
      })
      .receive(
        'error',
        (error: { readiness?: ReadinessSnapshot; reason?: unknown; error_code?: unknown }) => {
          attempt.record('push', diagnosticCode(error?.error_code ?? error?.reason));
          const snapshot = lifecycleFromReply(error);
          if (snapshot && globalGameChannel === channel)
            applyLifecycle(snapshot, true, notifySeatEvent);
          if (globalGameChannel === channel && error?.readiness)
            useGameStore.getState().setReadiness(error.readiness);
          reject(error);
        }
      )
      .receive('timeout', () => {
        attempt.record('timeout', 'unavailable');
        reject({ reason: 'timeout' });
        // A late timeout from the previous join must not tear down a healthy rejoin.
        if (
          globalGameChannel === channel &&
          channel.state === 'joined' &&
          channel.joinRef() === joinRef
        ) {
          useGameStore.getState().setChannelStatus(false, true);
          phoenixSocket.reconnect('push_timeout');
        }
      });
  });
}

export function refreshSeatLifecycle(): Promise<void> {
  return pushGameAction('get_seat_lifecycle', {});
}
