import {
  pushGameAction,
  refreshSeatLifecycle,
  useGameChannel,
  type ProgressionSummary,
} from '@/channels/hooks/useGameChannel';
import { terminalGameJoinFailure } from '@/channels/gameJoinFailure';
import type { WaitingRoomEvent } from '@/channels/gameRoomEvents';
import { useLobbyChannel } from '@/channels/hooks/useLobbyChannel';
import { createCoalescedCallback } from '@/channels/gameRoomEvents';
import { View, Text, TouchableOpacity, StatusBar, StyleSheet } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLobbyStore } from '@/stores/lobby';
import { useGameStore } from '@/stores/game';
import { publicPlayerName, rematchVote, roomWithReadiness, type RematchVote } from '@pidro/shared';
import { useAuthStore } from '@/stores/auth';
import { lobbyApi } from '@/api/lobby';
import { api } from '@/api/client';
import { useCallback, useEffect, useId, useRef, useState, type ComponentType } from 'react';
import type { Position, Room } from '@/types/lobby';
import type { LegalAction, ServerGameState } from '@/types/game';
import { GameJoinFailureScreen } from '@/components/game/GameJoinFailureScreen';
import { GameLoadingScreen } from '@/components/game/GameLoadingScreen';
import { AuthSheet } from '@/components/auth/AuthSheet';
import { NewTableScreen } from '@/components/lobby/NewTableScreen';
import { InviteLinkModal } from '@/components/invites/InviteLinkModal';
import { TableInvitation } from '@/components/invites/TableInvitation';
import { Background } from '@/components/ui/Background';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { PidroSpacing } from '@/design/tokens';
import { loadGameCanvasTable } from '@/game/canvas/loadGameCanvasTable';
import { gameExitPath, parseGameOrigin } from '@/navigation/gameRoute';
import { canManageRoom } from '@/features/invites/hostControls';
import { claimDailyGuestSavePrompt } from '@/features/auth/guestSavePrompt';
import { tableInvitation } from '@/features/invites/tableInvitation';
import { readingTimeMs } from '@/features/game/readingTime';
import { t, useTranslation } from '@/i18n';
import { useSeatDecisions } from '@pidro/shared';
import { TableFeedback, TableSeatDecision, useTableNotices } from '@/components/game/TableFeedback';
import { actionTap, pushAttempt } from '@/diagnostics/actions';

type SkiaTableProps = {
  room: Room;
  progressionSummary?: ProgressionSummary | null;
  onLeave: () => void;
  onPlayAgain?: () => void;
  rematch?: RematchVote | null;
  rematchPending?: boolean;
  roomFinished?: boolean;
  onHome?: () => void;
  playAgainLabel?: string;
  guest?: boolean;
  showGuestSave?: boolean;
  onSaveGuest?: () => void;
  topDock?: number;
};

/**
 * Loads the Skia table dynamically so the Skia module is NEVER evaluated at app
 * boot (Expo Router imports every route file at startup; an eager Skia import runs
 * before CanvasKit loads and breaks every canvas on web). The platform-specific
 * loader keeps CanvasKit imports out of native bundles.
 */
function SkiaGameTable(props: SkiaTableProps) {
  useTranslation();
  const [Comp, setComp] = useState<ComponentType<SkiaTableProps> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadGameCanvasTable()
      .then((Component) => {
        if (active) setComp(() => Component);
      })
      .catch((error) => {
        console.error('[GameScreen] failed to load Skia table', error);
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  if (loadError) {
    return (
      <Background>
        <View style={styles.tableLoadState}>
          <Surface variant="window" style={styles.tableLoadWindow} padded accessibilityRole="alert">
            <PidroText role="title" align="center">
              {t('game.load_failed')}
            </PidroText>
            <PidroText role="body" tone="soft" align="center">
              {t('game.load_description')}
            </PidroText>
            <View style={styles.tableLoadActions}>
              <BevelButton
                label={t('game.leave')}
                material="glass"
                onPress={props.onLeave}
                style={styles.tableLoadButton}
              />
              <BevelButton
                label={t('game.try_again')}
                onPress={() => {
                  setComp(null);
                  setLoadError(false);
                  setLoadAttempt((attempt) => attempt + 1);
                }}
                style={styles.tableLoadButton}
              />
            </View>
          </Surface>
        </View>
      </Background>
    );
  }

  if (!Comp) {
    return <GameLoadingScreen label={t('game.loading')} />;
  }
  return <Comp {...props} />;
}

const styles = StyleSheet.create({
  tableLoadState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: PidroSpacing.md,
  },
  tableLoadWindow: {
    width: '100%',
    maxWidth: 520,
    gap: PidroSpacing.md,
  },
  tableLoadActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: PidroSpacing.sm,
  },
  tableLoadButton: {
    minWidth: 144,
    flex: 1,
  },
});

/**
 * Full-screen game view for Pidro
 * Route: /game/{room_code}
 */
export default function GameScreen() {
  useTranslation();
  const {
    code,
    origin: originParam,
    fixture,
  } = useLocalSearchParams<{ code: string; origin?: string; fixture?: string }>();
  const origin = parseGameOrigin(originParam);
  const exitPath = gameExitPath(origin);
  const router = useRouter();
  const rooms = useLobbyStore((s) => s.rooms);
  const updateRoom = useLobbyStore((s) => s.updateRoom);
  const removeRoom = useLobbyStore((s) => s.removeRoom);
  const youPlayerId = useAuthStore((s) => s.user?.id ?? '');
  const currentUser = useAuthStore((s) => s.user);
  const youUsername = useAuthStore((s) =>
    s.user ? publicPlayerName(s.user.username, 'Player', s.user.display_name) : null
  );
  const authHydrated = useAuthStore((s) => s.hydrated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const initGame = useGameStore((s) => s.initFromRoom);
  const resetGame = useGameStore((s) => s.reset);
  const setServerState = useGameStore((s) => s.setServerState);
  const setLegalActions = useGameStore((s) => s.setLegalActions);
  const youPositionAbs = useGameStore((s) => s.youPositionAbs);
  const role = useGameStore((s) => s.role);
  const readiness = useGameStore((s) => s.readiness);
  const isChannelJoined = useGameStore((s) => s.isChannelJoined);
  const lastError = useGameStore((s) => s.lastError);
  const away = useGameStore((s) => s.isAway) || (__DEV__ && fixture === 'away');
  const setAway = useGameStore((s) => s.setAway);
  const handleReady = useCallback(
    () =>
      actionTap('ready', () => {
        if (!readiness || !isChannelJoined || role !== 'player') {
          pushAttempt('ready').record('blocked', !isChannelJoined ? 'disconnected' : 'unavailable');
          return Promise.reject(new Error('Reconnect before confirming readiness.'));
        }
        return pushGameAction('ready', {
          room_id: readiness.room_id,
          ready_epoch: readiness.ready_epoch,
        });
      }),
    [readiness, isChannelJoined, role]
  );
  const setSeatStatus = useGameStore((s) => s.setSeatStatus);
  const seatInvitations = useAuthStore((s) => s.seatInvitations);
  const invitation = tableInvitation(seatInvitations, readiness, youPositionAbs, role);
  // Joining a held seat leaves this table: its channel goes first, so the
  // closing room cannot flash its own ending before the next table opens.
  const [leavingForSeat, setLeavingForSeat] = useState(false);
  const [invitationHeight, setInvitationHeight] = useState(0);

  // Identity snapshots also update direct-link games without a lobby in the stack.
  useLobbyChannel();

  // Turn timers keep running while a player waits on the others, so the table holds
  // the screen awake while it is focused. Each focus gets its own tag, so a late release
  // from the last visit cannot drop this one; released on blur/unmount.
  const keepAwakeId = useId();
  const keepAwakeVisits = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const tag = `${keepAwakeId}:${(keepAwakeVisits.current += 1)}`;
      const activation = activateKeepAwakeAsync(tag).catch(() => {});
      return () => {
        activation.then(() => deactivateKeepAwake(tag)).catch(() => {});
      };
    }, [keepAwakeId])
  );

  const [roomLookup, setRoomLookup] = useState<{
    roomCode: string;
    room?: Room;
  } | null>(null);
  const room =
    rooms.find((candidate) => candidate.code === code) ??
    (roomLookup?.roomCode === code ? roomLookup.room : undefined);
  // The host's own room read carries the password, so it returns on reload. Lobby,
  // channel and readiness snapshots still omit it; keep the last private answer,
  // scoped to this room and host.
  const [hostPassword, setHostPassword] = useState(() =>
    room?.seat_password && room.host_id === youPlayerId
      ? { code: room.code, host: youPlayerId, value: room.seat_password }
      : null
  );

  useEffect(() => {
    if (!room) return;
    useGameStore.getState().refreshPlayerIdentities(room);
  }, [room]);
  const [progressionResult, setProgressionResult] = useState<{
    roomCode: string;
    summary: ProgressionSummary;
  } | null>(null);
  const progressionSummary =
    progressionResult?.roomCode === code ? progressionResult.summary : null;
  const [restoreFailureCode, setRestoreFailureCode] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [controlsBusy, setControlsBusy] = useState(false);
  const controlsBusyRef = useRef(false);
  const [joiningName, setJoiningName] = useState<string | null>(null);
  const [declined, setDeclined] = useState<
    (Extract<WaitingRoomEvent, { kind: 'declined' }> & { roomCode: string }) | null
  >(null);
  const joiningNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingRoomExitRef = useRef(false);
  const activeRoomCodeRef = useRef(code);
  const roomRequestGenerationRef = useRef(0);
  const refreshSchedulerRef = useRef<ReturnType<typeof createCoalescedCallback> | null>(null);

  useEffect(() => {
    waitingRoomExitRef.current = false;
    activeRoomCodeRef.current = code;
    roomRequestGenerationRef.current += 1;
    return () => {
      waitingRoomExitRef.current = true;
      roomRequestGenerationRef.current += 1;
    };
  }, [code]);

  const applyRoomSnapshot = useCallback(
    (requestedCode: string, generation: number, fetchedRoom: Room) => {
      if (
        waitingRoomExitRef.current ||
        activeRoomCodeRef.current !== requestedCode ||
        roomRequestGenerationRef.current !== generation
      ) {
        return;
      }
      setRoomLookup({ roomCode: requestedCode, room: fetchedRoom });
      if (fetchedRoom.seat_password && fetchedRoom.host_id === youPlayerId)
        setHostPassword({
          code: requestedCode,
          host: youPlayerId,
          value: fetchedRoom.seat_password,
        });
      updateRoom(fetchedRoom);
    },
    [updateRoom, youPlayerId]
  );

  // Hide status bar when entering game
  useEffect(() => {
    StatusBar.setHidden(true, 'slide');
    return () => {
      StatusBar.setHidden(false, 'slide');
    };
  }, []);

  // Initialize game store when room is available and we have user info
  useEffect(() => {
    if (room && youPlayerId) {
      initGame({ room, youPlayerId });
    }
  }, [room, youPlayerId, initGame]);

  useEffect(() => {
    if (youPositionAbs && youUsername) {
      setSeatStatus(youPositionAbs, 'normal', youUsername);
    }
  }, [youPositionAbs, youUsername, setSeatStatus]);

  // Get current game phase from the game store
  const serverPhase = useGameStore((s) => s.serverState?.phase);
  const tableIsWaiting = readiness?.status === 'waiting' || readiness?.status === 'ready';
  const completedGame =
    (serverPhase === 'complete' || serverPhase === 'game_over') &&
    readiness?.status === 'finished' &&
    role === 'player';
  // Waiting for the others is when a slow phone loads the table and decodes its
  // cards, so they are ready by the time the game starts.
  useEffect(() => {
    if (tableIsWaiting) loadGameCanvasTable().catch(() => undefined);
  }, [tableIsWaiting]);
  const [showGuestSave, setShowGuestSave] = useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const promptedCompletionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!completedGame || !currentUser?.guest || promptedCompletionRef.current === code) return;
    promptedCompletionRef.current = code;
    let active = true;
    void claimDailyGuestSavePrompt(currentUser.id)
      .then((show) => {
        if (active && show) setShowGuestSave(true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [code, completedGame, currentUser?.guest, currentUser?.id]);
  const shouldRestoreServerState =
    !tableIsWaiting && (room?.status === 'playing' || room?.status === 'finished') && !serverPhase;

  // Refetch the room once when the game starts: the snapshot fetched while
  // 'waiting' predates late joiners, so seat usernames would otherwise stay
  // stale placeholders for the whole game.
  const refreshedForGameRef = useRef<string | null>(null);
  useEffect(() => {
    if (!serverPhase || !code || !authHydrated || !accessToken) return;
    if (refreshedForGameRef.current === code) return;
    refreshedForGameRef.current = code;
    const generation = ++roomRequestGenerationRef.current;
    lobbyApi
      .getRoom(code)
      .then((fetchedRoom) => {
        applyRoomSnapshot(code, generation, fetchedRoom);
      })
      .catch(() => {});
  }, [serverPhase, code, authHydrated, accessToken, applyRoomSnapshot]);

  // Subscribe to the game channel as soon as we're seated — including while the
  // room is still 'waiting'. The server broadcasts the initial game_state on
  // this channel when the game starts, so a waiting owner/joiner flips to the
  // table without needing a lobby-channel round trip (previously the owner
  // could stay stuck on the waiting screen after the last seat filled).
  const hasGameState = !!serverPhase;
  const canJoinGameChannel =
    authHydrated &&
    !!accessToken &&
    !!room &&
    (room.status !== 'finished' || hasGameState) &&
    !leavingForSeat;
  const { notice, addNotice: handleSeatEvent, dismissNotice, clearNotices } = useTableNotices(code);
  const decisions = useSeatDecisions(pushGameAction, refreshSeatLifecycle);
  // A solo table waits for you to say you are ready, as Classic's "Tap to
  // start the game" does: the bots sit ready, and nothing deals until you do.

  const handleProgressionSummary = useCallback(
    (summary: ProgressionSummary) => {
      if (code) setProgressionResult({ roomCode: code, summary });
    },
    [code]
  );

  const refreshWaitingRoom = useCallback(async () => {
    if (!code || waitingRoomExitRef.current) return;
    const generation = ++roomRequestGenerationRef.current;
    try {
      const fetchedRoom = await lobbyApi.getRoom(code);
      applyRoomSnapshot(code, generation, fetchedRoom);
    } catch {
      if (roomRequestGenerationRef.current === generation && !waitingRoomExitRef.current) {
        console.warn('[GameScreen] Waiting-room refresh failed.');
      }
    }
  }, [applyRoomSnapshot, code]);

  useEffect(() => {
    const scheduler = createCoalescedCallback(() => void refreshWaitingRoom());
    refreshSchedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      if (refreshSchedulerRef.current === scheduler) refreshSchedulerRef.current = null;
    };
  }, [refreshWaitingRoom]);
  useEffect(
    () => () => {
      if (joiningNoticeTimerRef.current) clearTimeout(joiningNoticeTimerRef.current);
    },
    []
  );

  const handleWaitingRoomEvent = useCallback(
    (event: WaitingRoomEvent) => {
      if (event.kind === 'kicked') {
        waitingRoomExitRef.current = true;
        refreshSchedulerRef.current?.dispose();
        if (code) removeRoom(code);
        router.dismissTo('/lobby');
        return;
      }
      if (event.kind === 'declined') {
        if (code) setDeclined({ ...event, roomCode: code });
      } else if (event.joiningName) {
        setJoiningName(event.joiningName);
        if (joiningNoticeTimerRef.current) clearTimeout(joiningNoticeTimerRef.current);
        joiningNoticeTimerRef.current = setTimeout(
          () => setJoiningName(null),
          readingTimeMs(t('table.joining', { name: event.joiningName }))
        );
      }
      refreshSchedulerRef.current?.trigger();
    },
    [code, removeRoom, router]
  );

  useGameChannel({
    roomCode: code ?? '',
    enabled: canJoinGameChannel,
    onSeatEvent: handleSeatEvent,
    onProgressionSummary: handleProgressionSummary,
    onWaitingRoomEvent: handleWaitingRoomEvent,
  });

  const canManage = isChannelJoined && room ? canManageRoom(room, youPlayerId, role) : false;

  useEffect(() => {
    if (!code || !authHydrated || !accessToken || !shouldRestoreServerState) {
      return;
    }

    let cancelled = false;

    const restoreServerState = async () => {
      try {
        const response = await api.get<{
          data?: {
            state?: ServerGameState;
            game_state?: ServerGameState;
            legal_actions?: LegalAction[];
          };
          state?: ServerGameState;
          game_state?: ServerGameState;
          legal_actions?: LegalAction[];
        }>(`/api/v1/rooms/${code}/state`);
        if (cancelled) return;

        const payload = response.data;
        const restoredState =
          payload?.data?.state ??
          payload?.data?.game_state ??
          payload?.state ??
          payload?.game_state ??
          null;
        const legalActions = payload?.data?.legal_actions ?? payload?.legal_actions ?? [];

        if (useGameStore.getState().serverState) return;
        if (!restoredState) throw new Error('The server returned no game state.');

        setServerState(restoredState);
        setLegalActions(legalActions);
      } catch {
        if (!cancelled && !useGameStore.getState().serverState) {
          console.warn('[GameScreen] Failed to restore game state.');
          setRestoreFailureCode(code);
        }
      }
    };

    restoreServerState();

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    authHydrated,
    code,
    restoreAttempt,
    setLegalActions,
    setServerState,
    shouldRestoreServerState,
  ]);

  // Clean up game store when leaving screen
  useEffect(() => {
    return () => resetGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch room details on entry. The lobby store can be stale after a refresh or
  // route restore, so always ask the server for the current room status.
  useEffect(() => {
    let cancelled = false;

    const fetchRoom = async () => {
      if (!code || !authHydrated || !accessToken) return;
      const generation = ++roomRequestGenerationRef.current;

      try {
        const fetchedRoom = await lobbyApi.getRoom(code);
        if (cancelled) return;
        applyRoomSnapshot(code, generation, fetchedRoom);
      } catch {
        if (!cancelled && roomRequestGenerationRef.current === generation) {
          setRoomLookup({ roomCode: code });
          console.error('[GameScreen] Failed to fetch room details.');
        }
      }
    };

    fetchRoom();

    return () => {
      cancelled = true;
    };
  }, [accessToken, applyRoomSnapshot, authHydrated, code]);

  // A rematch is an intent on the game channel: the server restarts the game
  // in this room once every human has asked. Nothing navigates; the next
  // game's state arrives on the channel we are already joined to.
  const rematchPendingRef = useRef(false);
  const [rematchPending, setRematchPending] = useState(false);
  const handlePlayAgain = useCallback(
    () =>
      actionTap('rematch', () => {
        if (!readiness || !isChannelJoined || role !== 'player' || rematchPendingRef.current) {
          pushAttempt('rematch').record(
            'blocked',
            rematchPendingRef.current
              ? 'pending'
              : !isChannelJoined
                ? 'disconnected'
                : 'unavailable'
          );
          return;
        }
        rematchPendingRef.current = true;
        setRematchPending(true);
        pushGameAction('rematch', {
          room_id: readiness.room_id,
          ready_epoch: readiness.ready_epoch,
        })
          .catch((error: unknown) => {
            // A stale epoch reply carries the current snapshot, already applied by
            // pushGameAction, so pressing again sends the right epoch.
            handleSeatEvent({ error, key: 'table.rematch.failed', variant: 'warning' });
          })
          .finally(() => {
            rematchPendingRef.current = false;
            setRematchPending(false);
          });
      }),
    [readiness, isChannelJoined, role, handleSeatEvent]
  );
  const rematch = rematchVote(readiness, youPositionAbs);
  const tableReopened = tableIsWaiting && hasGameState;
  useEffect(() => {
    if (!tableReopened) return;
    // Notices still queued belong to the game that just ended.
    clearNotices();
    handleSeatEvent({ key: 'table.reopened', variant: 'warning' });
  }, [tableReopened, handleSeatEvent, clearNotices]);

  const handleLeaveGame = (destination = exitPath) => {
    const roomCode = room?.code ?? code;

    if (roomCode) {
      const leaveRequest =
        role === 'spectator' ? lobbyApi.unwatchRoom(roomCode) : lobbyApi.leaveRoom(roomCode);
      void leaveRequest.catch(() => {
        console.warn('[GameScreen] Failed to leave the table cleanly.');
      });
    }

    // Back to the Lobby or Home under the table; a table opened from a link has none, and replaces.
    router.dismissTo(destination);
  };

  const runRoomControl = useCallback(
    async (action: () => Promise<Room>, rethrow = false) => {
      if (controlsBusyRef.current) return;
      controlsBusyRef.current = true;
      setControlsBusy(true);
      const requestedCode = activeRoomCodeRef.current;
      roomRequestGenerationRef.current += 1;
      try {
        const updated = await action();
        const generation = ++roomRequestGenerationRef.current;
        if (requestedCode) applyRoomSnapshot(requestedCode, generation, updated);
      } catch (caught) {
        if (!rethrow) {
          handleSeatEvent({ error: caught, key: 'table.actionError', variant: 'error' });
          return;
        }
        // The caller shows the refusal; the seat is whatever the server now says it is.
        refreshSchedulerRef.current?.trigger();
        throw caught;
      } finally {
        controlsBusyRef.current = false;
        setControlsBusy(false);
      }
    },
    [applyRoomSnapshot, handleSeatEvent]
  );

  const handleKickPlayer = useCallback(
    (position: Position) => {
      if (!room || !canManage) return;
      void runRoomControl(() => lobbyApi.kickPlayer(room.code, position));
    },
    [canManage, room, runRoomControl]
  );

  if (__DEV__ && (fixture === 'joining' || fixture === 'restoring' || fixture === 'loading')) {
    return <GameLoadingScreen label={t(`game.${fixture}`)} />;
  }

  if (authHydrated && !accessToken) {
    return (
      <Background>
        <Redirect href="/welcome" />
      </Background>
    );
  }

  const terminalJoinFailure = terminalGameJoinFailure(lastError);
  if (terminalJoinFailure) {
    const destination = exitPath;

    return (
      <GameJoinFailureScreen
        failure={terminalJoinFailure}
        exitLabel={destination === '/home' ? 'Back home' : 'Back to lobby'}
        onExit={() => {
          if (code) removeRoom(code);
          router.dismissTo(destination);
        }}
      />
    );
  }

  if (away) {
    return (
      <GameJoinFailureScreen
        failure="away"
        exitLabel={exitPath === '/home' ? 'Back home' : 'Back to lobby'}
        onExit={() => router.dismissTo(exitPath)}
        onReturn={() => setAway(false)}
      />
    );
  }

  if (!room && roomLookup?.roomCode !== code) {
    return <GameLoadingScreen label={t('game.joining')} />;
  }

  if (shouldRestoreServerState && authHydrated && accessToken) {
    if (restoreFailureCode === code) {
      return (
        <Background>
          <View style={styles.tableLoadState}>
            <Surface
              variant="window"
              style={styles.tableLoadWindow}
              padded
              accessibilityRole="alert">
              <PidroText role="title" align="center">
                {t('game.restore_failed')}
              </PidroText>
              <PidroText role="body" tone="soft" align="center">
                {t('game.restore_description')}
              </PidroText>
              <View style={styles.tableLoadActions}>
                <BevelButton
                  label={t(origin === 'single-player' ? 'game.back_home' : 'game.lobby')}
                  material="glass"
                  onPress={() => router.dismissTo(exitPath)}
                  style={styles.tableLoadButton}
                />
                <BevelButton
                  label={t('game.try_again')}
                  onPress={() => {
                    setRestoreFailureCode(null);
                    setRestoreAttempt((attempt) => attempt + 1);
                  }}
                  style={styles.tableLoadButton}
                />
              </View>
            </Surface>
          </View>
        </Background>
      );
    }

    return <GameLoadingScreen label={t('game.restoring')} />;
  }

  if (!room) {
    return (
      <Background>
        <SafeAreaView style={{ flex: 1 }}>
          <View className="flex-1 items-center justify-center p-4">
            <Text className="text-xl font-bold text-white">{t('game.not_found')}</Text>
            <TouchableOpacity
              onPress={() => handleLeaveGame()}
              className="mt-4 rounded-lg bg-white/10 px-6 py-3">
              <Text className="font-semibold text-white">{t('game.back')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Background>
    );
  }

  // Show game table when we have active game state (any in-game phase)
  // This prevents unmounting during phase transitions like dealer_selection
  const inGamePhases = [
    'dealer_selection',
    'dealing',
    'bidding',
    'declaring',
    'declaring_trump',
    'trump_declaration',
    'discarding',
    'second_deal',
    'playing',
    'scoring',
    'hand_complete',
    'complete',
    'game_over',
    'finished',
  ];
  const isInGamePhase = serverPhase && inGamePhases.includes(serverPhase);

  // A reconnect may miss both game completion and the host's leave. The
  // versioned waiting snapshot wins even if the cached game still says playing.
  if (!tableIsWaiting && (room.status === 'playing' || isInGamePhase)) {
    return (
      <View className="flex-1">
        <SkiaGameTable
          room={room}
          progressionSummary={progressionSummary}
          onLeave={() => handleLeaveGame()}
          onPlayAgain={handlePlayAgain}
          rematch={rematch}
          rematchPending={rematchPending}
          roomFinished={readiness ? readiness.status === 'finished' : true}
          onHome={() => handleLeaveGame('/home')}
          playAgainLabel={origin === 'single-player' ? t('game.play_again') : undefined}
          guest={Boolean(currentUser?.guest)}
          showGuestSave={showGuestSave && Boolean(currentUser?.guest)}
          onSaveGuest={() => setAccountSheetOpen(true)}
          topDock={invitation ? invitationHeight : 0}
        />
        <AuthSheet
          isOpen={accountSheetOpen}
          reason="postGame"
          onClose={() => setAccountSheetOpen(false)}
          onClaimClassic={() => {
            setAccountSheetOpen(false);
            router.push('/(auth)/claim-classic');
          }}
        />
        <TableFeedback notice={notice} onDismiss={dismissNotice} />
        <TableSeatDecision key={room.code} decisions={decisions} />
        {invitation ? (
          <TableInvitation
            key={`${invitation.code}-${invitation.position}`}
            invitation={invitation}
            roomCode={room.code}
            onLeaving={setLeavingForSeat}
            onHeight={setInvitationHeight}
          />
        ) : null}
      </View>
    );
  }

  const waitingRoom = readiness ? roomWithReadiness(room, readiness) : room;
  return (
    <>
      <NewTableScreen
        room={{
          ...waitingRoom,
          seat_password:
            hostPassword?.code === code &&
            hostPassword.host === youPlayerId &&
            room.host_id === youPlayerId
              ? hostPassword.value
              : undefined,
        }}
        youPlayerId={role === 'player' ? youPlayerId : ''}
        isSpectator={role === 'spectator'}
        readyPlayers={readiness?.ready_players}
        readyDisabled={!isChannelJoined || !readiness}
        onReady={role === 'player' && youPositionAbs ? handleReady : undefined}
        onLeave={() => handleLeaveGame()}
        canManage={canManage && origin !== 'single-player'}
        joiningName={joiningName}
        controlsBusy={controlsBusy}
        onOpenInvite={() => setShareOpen(true)}
        onSetSeat={async (position, seat) => {
          if (canManage)
            await runRoomControl(() => lobbyApi.setSeat(room.code, position, seat), true);
        }}
        onKickPlayer={handleKickPlayer}
        notice={notice}
        onDismissNotice={dismissNotice}
        declined={declined?.roomCode === code && room.host_id === youPlayerId ? declined : null}
        onDismissDeclined={() => setDeclined(null)}
      />
      {canManage && shareOpen ? (
        <InviteLinkModal key={room.code} roomCode={room.code} onClose={() => setShareOpen(false)} />
      ) : null}
    </>
  );
}
