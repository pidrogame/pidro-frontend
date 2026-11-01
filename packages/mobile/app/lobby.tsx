import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { LobbyCategoryKey } from '@pidro/shared';
import { lobbyFixture, seatInvitationsFixture } from '@/features/lobby/fixtures';
import { roomHasUser } from '@/features/lobby/newTable';
import { filterPlayers, lobbyCounts, seatRequirementMessage } from '@/features/lobby/tableRow';
import {
  emptyEntry,
  passwordAnswer,
  passwordSeatWords,
  type PasswordEntry,
} from '@/features/lobby/passwordSeat';
import { pickProfile } from '@/game/canvas/layout';
import { captureAnalytics } from '@/analytics/PostHogAnalytics';
import { lobbyApi } from '@/api/lobby';
import { useLobbyChannel } from '@/channels/hooks/useLobbyChannel';
import { PasswordKeypadSheet } from '@/components/lobby/PasswordKeypadSheet';
import { RoomCard } from '@/components/lobby/RoomCard';
import { SeatInvitations } from '@/components/invites/SeatInvitations';
import { OpenChair } from '@/components/lobby/OpenChair';
import { AuthFlowButton, AuthFlowHeading } from '@/components/auth/AuthFlow';
import { AuthSheet } from '@/components/auth/AuthSheet';
import { BevelButton } from '@/components/ui/BevelButton';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { PidroText } from '@/components/ui/PidroText';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { PidroBevel, PidroColors, PidroLayout, PidroSpacing } from '@/design/tokens';
import { useQuickGame } from '@/hooks/useQuickGame';
import { useProfileIdentity } from '@/hooks/useProfileIdentity';
import { useAuthStore } from '@/stores/auth';
import { useLobbyStore } from '@/stores/lobby';
import type { Position, Room } from '@/types/lobby';
import { apiErrorInfo, localizedError } from '@/utils/apiErrors';
import { useTranslation, formatNumber, type TranslationKey } from '@/i18n';

type LobbyFailure =
  { error?: unknown; fallback: TranslationKey } | { minimum: number; played: number };

function failureText(failure?: LobbyFailure): string | undefined {
  if (!failure) return undefined;
  return 'minimum' in failure
    ? seatRequirementMessage(failure.minimum, failure.played)
    : localizedError(failure.error, failure.fallback);
}

function uniqueRooms(rooms: Room[]): Room[] {
  const seen = new Set<string>();
  return rooms.filter((room) => {
    if (!room.code || seen.has(room.code)) return false;
    seen.add(room.code);
    return true;
  });
}

export default function LobbyScreen() {
  const { fixture: fixtureParam } = useLocalSearchParams<{ fixture?: string }>();
  return <LobbyContent key={fixtureParam ?? 'live'} fixture={lobbyFixture(fixtureParam)} />;
}

function LobbyRealtime({ onUpdate }: { onUpdate: () => void }) {
  useLobbyChannel(onUpdate);
  return null;
}

function LobbyContent({ fixture }: { fixture: ReturnType<typeof lobbyFixture> }) {
  const { t } = useTranslation();
  const { fixture: fixtureParam } = useLocalSearchParams<{ fixture?: string }>();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const profile = pickProfile(width, height);
  const portraitPhone = profile === 'phone-portrait';
  const columns = portraitPhone ? 1 : profile === 'tablet-landscape' ? 3 : 2;
  const tablet = profile.startsWith('tablet');
  const user = useAuthStore((state) => state.user);
  const {
    rooms: storedRooms,
    lobby: storedLobby,
    stats,
    isLoading: storedLoading,
    error: storedError,
    setRooms,
    setLobby,
    setStats,
    setLoading,
    setError,
    upsertLobbyRoom,
  } = useLobbyStore();
  const lobby = fixture?.lobby ?? storedLobby;
  const rooms = fixture ? Object.values(fixture.lobby).flat() : storedRooms;
  const isLoading = fixture ? false : storedLoading;
  const error = fixture ? null : storedError;
  const [query, setQuery] = useState(fixture?.query ?? '');
  const [rowErrors, setRowErrors] = useState<Record<string, LobbyFailure | undefined>>({});
  const [joining, setJoining] = useState<string | null>(null);
  const [passwordSeat, setPasswordSeat] = useState<{
    code: string;
    position: Position;
    words: ReturnType<typeof passwordSeatWords>;
    initial: PasswordEntry;
  } | null>(() => {
    const seat = fixture?.password;
    const room = fixture?.lobby.open_tables.find((table) => table.code === seat?.code);
    return seat && room ? { ...seat, words: passwordSeatWords(room, seat.position) } : null;
  });
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const pendingAccountActionRef = useRef<(() => Promise<void>) | null>(null);
  const realtimeRevisionRef = useRef(0);
  const quickGame = useQuickGame();
  const refreshIdentity = useProfileIdentity();
  const [record, setRecord] = useState<{ userId: string; games?: number }>();
  const gamesPlayed = fixture
    ? fixture.gamesPlayed
    : record?.userId === user?.id
      ? record?.games
      : undefined;

  useFocusEffect(
    useCallback(() => {
      if (fixture || !user?.id) return;
      let active = true;
      void refreshIdentity()
        .then((identity) => {
          if (active && identity)
            setRecord({ userId: identity.user_id, games: identity.record?.games });
        })
        .catch(() => {
          if (active) setRecord(undefined);
        });
      return () => {
        active = false;
      };
    }, [fixture, refreshIdentity, user?.id])
  );

  useEffect(() => {
    if (!Object.values(rowErrors).some(Boolean)) return;
    const timer = setTimeout(() => setRowErrors({}), 5000);
    return () => clearTimeout(timer);
  }, [rowErrors]);

  const showSeatReason = useCallback((code: string, minimum: number, played: number) => {
    setRowErrors((errors) => ({ ...errors, [code]: { minimum, played } }));
  }, []);

  const openPassword = useCallback(
    (code: string, position: Position) => {
      const room = Object.values(lobby)
        .flat()
        .find((table) => table.code === code);
      if (room)
        setPasswordSeat({
          code,
          position,
          words: passwordSeatWords(room, position),
          initial: emptyEntry,
        });
    },
    [lobby]
  );

  const requestAccount = useCallback((retry: () => Promise<void>) => {
    pendingAccountActionRef.current = retry;
    setAccountSheetOpen(true);
  }, []);

  const markRealtimeUpdate = useCallback(() => {
    realtimeRevisionRef.current += 1;
  }, []);

  const activeRooms = useMemo(
    () =>
      uniqueRooms([
        ...lobby.my_rejoinable,
        ...lobby.open_tables.filter((room) => roomHasUser(room, user?.id)),
        ...rooms.filter((room) => room.status !== 'finished' && roomHasUser(room, user?.id)),
      ]),
    [lobby.my_rejoinable, lobby.open_tables, rooms, user?.id]
  );
  const activeRoom = activeRooms[0] ?? null;
  // Fallback player labels depend on the current locale, so do not cache them.
  const openTables = filterPlayers(lobby.open_tables, query);
  const rejoinableTables = filterPlayers(lobby.my_rejoinable, query);
  const substituteTables = filterPlayers(lobby.substitute_needed, query);
  const watchTables = filterPlayers(lobby.spectatable, query);
  const visibleTableCount =
    rejoinableTables.length + openTables.length + substituteTables.length + watchTables.length;
  const hasQuery = query.trim().length > 0;
  const hasNoResults = !isLoading && hasQuery && visibleTableCount === 0;
  const isUnavailable = !isLoading && !!error && visibleTableCount === 0;
  const isEmptyLobby =
    !isLoading &&
    !hasQuery &&
    !isUnavailable &&
    activeRooms.length === 0 &&
    Object.values(lobby).every((tables) => tables.length === 0);

  const loadLobby = useCallback(async () => {
    if (fixture) return;
    const revisionAtStart = realtimeRevisionRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await lobbyApi.listLobby();
      if (realtimeRevisionRef.current === revisionAtStart) {
        setLobby(response.lobby);
        setStats({ active_games: response.rooms.length });
      }
    } catch {
      console.warn('[Lobby] Categorized lobby unavailable; falling back to the room list.');
      try {
        const response = await lobbyApi.listRooms();
        if (realtimeRevisionRef.current === revisionAtStart) {
          setRooms(response?.rooms || []);
          if (response?.meta) setStats(response.meta);
        }
      } catch {
        setError('social.load_error');
        console.error('[Lobby] Failed to load tables from either lobby endpoint.');
      }
    } finally {
      setLoading(false);
    }
  }, [fixture, setError, setLoading, setLobby, setRooms, setStats]);

  useEffect(() => {
    loadLobby();
  }, [loadLobby]);

  const handleJoinRoom = useCallback(
    async function joinRoom(
      code: string,
      position?: Position,
      mayRequestAccount = true,
      password?: string
    ): Promise<'wrong' | { wait: number } | void> {
      // A fixture keypad answers every password wrong, so its states can be walked through.
      if (fixture) return password ? 'wrong' : undefined;
      if (joining) return;
      setJoining(code);
      setRowErrors((errors) => ({ ...errors, [code]: undefined }));
      try {
        const response = await lobbyApi.joinRoom(code, position, password);
        captureAnalytics('room_joined', { join_source: 'lobby' });
        upsertLobbyRoom(response.room, 'my_rejoinable');
        setPasswordSeat(null);
        router.push(`/game/${code}`);
      } catch (joinError: unknown) {
        const answer = passwordAnswer(joinError);
        if (password && answer) return answer;
        // The lobby did not know this seat had a password yet: ask for it.
        if (answer === 'wrong' && position) {
          openPassword(code, position);
          return;
        }
        // Only this seat's keypad closes; a later one for another seat stays open.
        setPasswordSeat((seat) =>
          seat?.code === code && seat.position === position ? null : seat
        );
        const { code: errorCode, requirement } = apiErrorInfo(joinError);
        if (requirement) {
          showSeatReason(code, requirement.min_games, requirement.games_played);
          await loadLobby();
          return;
        }
        if (errorCode === 'ACCOUNT_REQUIRED') {
          if (mayRequestAccount) {
            // A password seat asks for its password again once the account is there.
            requestAccount(async () => void (await joinRoom(code, position, false)));
          } else {
            Alert.alert(t('social.join_failed'), localizedError(joinError, 'social.account_error'));
          }
          return;
        }
        if (errorCode === 'ALREADY_IN_ROOM') {
          if (activeRoom?.code === code) {
            router.push(`/game/${code}`);
            return;
          }
        }
        setRowErrors((errors) => ({
          ...errors,
          [code]: { error: joinError, fallback: 'social.seat_error' },
        }));
        await loadLobby();
      } finally {
        setJoining(null);
      }
    },
    [
      fixture,
      joining,
      upsertLobbyRoom,
      router,
      requestAccount,
      activeRoom?.code,
      loadLobby,
      showSeatReason,
      openPassword,
      t,
    ]
  );

  const handleWatchRoom = useCallback(
    async function watchRoom(code: string, mayRequestAccount = true) {
      if (fixture) return;
      try {
        await lobbyApi.watchRoom(code);
        router.push(`/game/${code}`);
      } catch (watchError: unknown) {
        const { code: errorCode } = apiErrorInfo(watchError);
        if (errorCode === 'ACCOUNT_REQUIRED' && mayRequestAccount) {
          requestAccount(() => watchRoom(code, false));
          return;
        }
        Alert.alert(t('social.watch_failed'), localizedError(watchError, 'social.watch_error'));
      }
    },
    [fixture, router, requestAccount, t]
  );

  const handleRowAction = useCallback(
    (code: string, category: LobbyCategoryKey) => {
      if (fixture) return;
      if (category === 'my_rejoinable') router.push(`/game/${code}`);
      else void handleWatchRoom(code);
    },
    [fixture, router, handleWatchRoom]
  );

  const handleNewTable = () => {
    if (fixture) return;
    if (activeRoom) {
      Alert.alert(t('social.current_table'), t('social.at_table'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('social.rejoin'), onPress: () => router.push(`/game/${activeRoom.code}`) },
      ]);
      return;
    }
    router.push('/new-table');
  };

  const search = (
    <View style={!portraitPhone && styles.search}>
      <Input
        compact
        value={query}
        onChangeText={setQuery}
        placeholder={t('social.find_player')}
        returnKeyType="search"
        accessibilityLabel={t('social.find_player')}
        style={{ paddingLeft: 40 }}
      />
      <View pointerEvents="none" style={styles.searchIcon}>
        <Icon name="search" size={18} color={PidroColors.textMuted} />
      </View>
    </View>
  );

  return (
    <ScreenShell testID="lobby-screen" contentStyle={[styles.shell, tablet && styles.tabletShell]}>
      {!fixture ? <LobbyRealtime onUpdate={markRealtimeUpdate} /> : null}
      <View style={styles.header}>
        <BevelButton
          material="glass"
          size="icon"
          accessibilityLabel={t('social.back')}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/home');
          }}>
          <Icon name="arrow-left" size={22} />
        </BevelButton>
        <View style={portraitPhone ? styles.headerTitle : styles.headerCounts}>
          <PidroText role="label" numberOfLines={1}>
            {t('social.playing_now', {
              number: formatNumber(fixture ? 104 : stats.online_players),
            })}
          </PidroText>
          <PidroText role="metadata" tone="soft">
            {lobbyCounts(lobby)}
          </PidroText>
        </View>
        {!portraitPhone && !isEmptyLobby ? search : null}
        {!portraitPhone && isEmptyLobby ? <View style={styles.headerTitle} /> : null}
        <BevelButton
          material={portraitPhone ? 'glass' : 'wood'}
          size={portraitPhone ? 'icon' : 'sm'}
          label={portraitPhone ? undefined : t('social.start')}
          accessibilityLabel={t('social.start')}
          onPress={handleNewTable}>
          <Icon name="plus" size={22} />
        </BevelButton>
      </View>
      {portraitPhone && !isEmptyLobby ? search : null}

      <View style={styles.content}>
        <SeatInvitations fixture={seatInvitationsFixture(fixtureParam)} scrollable />
        {quickGame.error ? (
          <Surface variant="subtle" style={styles.error} accessibilityRole="alert">
            <PidroText role="metadata" tone="danger">
              {quickGame.error}
            </PidroText>
          </Surface>
        ) : null}

        {error && !isUnavailable ? (
          <Surface variant="subtle" style={styles.error} accessibilityRole="alert">
            <PidroText role="metadata" tone="danger">
              {t('social.load_error')}
            </PidroText>
          </Surface>
        ) : null}

        {isLoading && rooms.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={PidroColors.cyan} />
            <PidroText role="body" tone="soft">
              {t('social.loading_tables')}
            </PidroText>
          </View>
        ) : isUnavailable ? (
          <LobbyEmptyState
            title={t('social.load_title')}
            description={t('social.load_error')}
            actionLabel={t('common.tryAgain')}
            onAction={loadLobby}
          />
        ) : isEmptyLobby ? (
          <EmptyLobby
            onStart={handleNewTable}
            onJoinCode={() => router.push('/join-code')}
            onQuickGame={quickGame.start}
            quickGameLoading={quickGame.loading}
          />
        ) : hasNoResults ? (
          <LobbyEmptyState
            title={t('social.no_matches')}
            description={t('social.search_help')}
            actionLabel={t('social.clear_search')}
            onAction={() => setQuery('')}
          />
        ) : (
          <ScrollView
            style={styles.roomScroll}
            contentContainerStyle={[
              styles.roomScrollContent,
              portraitPhone && { paddingBottom: 100 },
            ]}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={isLoading}
                onRefresh={loadLobby}
                tintColor={PidroColors.cyan}
              />
            }
            showsVerticalScrollIndicator={false}>
            {(
              [
                ['my_rejoinable', t('social.your_table'), rejoinableTables],
                ['open_tables', t('social.open_tables'), openTables],
                ['substitute_needed', t('social.needs_sub'), substituteTables],
                ['spectatable', t('social.watch'), watchTables],
              ] as [LobbyCategoryKey, string, Room[]][]
            ).map(([category, title, tables]) =>
              tables.length ? (
                <View key={category} style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <PidroText role="metadata" tone="cyan" style={styles.eyebrow}>
                      {title}
                    </PidroText>
                    {category === 'open_tables' ? (
                      <PidroText role="metadata" style={styles.goldHint}>
                        {t('social.tap_seat')}
                      </PidroText>
                    ) : null}
                  </View>
                  <View style={styles.roomGrid}>
                    {tables.map((room) => (
                      <View key={room.code} style={{ width: `${100 / columns}%`, padding: 5 }}>
                        <RoomCard
                          room={room}
                          category={category}
                          onJoin={handleJoinRoom}
                          gamesPlayed={gamesPlayed}
                          onLocked={showSeatReason}
                          onPassword={openPassword}
                          pending={joining === room.code}
                          error={failureText(rowErrors[room.code])}
                          onAction={handleRowAction}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              ) : null
            )}
          </ScrollView>
        )}
        {portraitPhone && !isEmptyLobby ? (
          <View testID="lobby-start" pointerEvents="box-none" style={styles.pinned}>
            <BevelButton label={t('social.start')} size="md" fullWidth onPress={handleNewTable} />
          </View>
        ) : null}
      </View>

      {passwordSeat ? (
        <PasswordKeypadSheet
          words={passwordSeat.words}
          initial={passwordSeat.initial}
          onSubmit={(password) =>
            handleJoinRoom(passwordSeat.code, passwordSeat.position, true, password)
          }
          onClose={() => setPasswordSeat(null)}
        />
      ) : null}
      <AuthSheet
        isOpen={accountSheetOpen}
        reason="multiplayer"
        onClose={() => {
          pendingAccountActionRef.current = null;
          setAccountSheetOpen(false);
        }}
        onSaved={() => {
          const retry = pendingAccountActionRef.current;
          pendingAccountActionRef.current = null;
          setAccountSheetOpen(false);
          void retry?.();
        }}
        onClaimClassic={() => {
          pendingAccountActionRef.current = null;
          setAccountSheetOpen(false);
          router.push('/(auth)/claim-classic');
        }}
      />
    </ScreenShell>
  );
}

function LobbyEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <ScrollView style={styles.roomScroll} keyboardShouldPersistTaps="handled">
      <View testID="lobby-empty-state" style={styles.emptyState}>
        <View style={styles.emptyCopy}>
          <PidroText role="title" align="center">
            {title}
          </PidroText>
          <PidroText role="body" tone="soft" align="center">
            {description}
          </PidroText>
        </View>
        <BevelButton
          label={actionLabel}
          material="glass"
          size="sm"
          onPress={onAction}
          style={styles.emptyAction}
        />
      </View>
    </ScrollView>
  );
}

/** Nobody is playing: four chairs and the three ways to start. */
function EmptyLobby({
  onStart,
  onJoinCode,
  onQuickGame,
  quickGameLoading,
}: {
  onStart: () => void;
  onJoinCode: () => void;
  onQuickGame: () => void;
  quickGameLoading: boolean;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const tablet = pickProfile(width, height).startsWith('tablet');
  const chairSize = width < 360 ? 44 : 56;

  return (
    <ScrollView
      style={styles.roomScroll}
      contentContainerStyle={[
        styles.emptyLobby,
        landscape && styles.emptyLobbyLandscape,
        tablet && styles.emptyLobbyTablet,
      ]}
      showsVerticalScrollIndicator={false}>
      <View
        testID="lobby-empty"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.emptyChairs,
          !landscape && !tablet && { marginTop: Math.min(120, height * 0.14) },
        ]}>
        <OpenChair size={chairSize} />
        <OpenChair size={chairSize} />
        <PidroText role="label" tone="muted">
          {t('social.vs')}
        </PidroText>
        <OpenChair size={chairSize} />
        <OpenChair size={chairSize} />
      </View>
      <View
        style={
          landscape ? styles.emptyColumnLandscape : [styles.emptyColumn, tablet && styles.grow0]
        }>
        <View style={styles.emptyLobbyCopy}>
          <AuthFlowHeading align="center" hero>
            {t('social.empty_title')}
          </AuthFlowHeading>
          <PidroText role="body" tone="soft" align="center">
            {t('social.empty_help')}
          </PidroText>
        </View>
        {landscape || tablet ? null : <View style={styles.emptySpacer} />}
        <View style={styles.emptyActions}>
          <AuthFlowButton label={t('social.start')} onPress={onStart} />
          <BevelButton
            label={t('social.join_code')}
            material="glass"
            size="md"
            fullWidth
            leadingIcon={<Icon name="hash" size={18} />}
            onPress={onJoinCode}
          />
          <TextLink label={t('social.or_bots')} disabled={quickGameLoading} onPress={onQuickGame} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    minHeight: 0,
    gap: PidroSpacing.sm,
    maxWidth: 1194,
    paddingHorizontal: 20,
  },
  tabletShell: { paddingHorizontal: 48, paddingTop: 32 },
  headerCounts: { width: 170 },
  searchIcon: { position: 'absolute', left: 13, top: 13 },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 1, fontWeight: '900', fontSize: 11 },
  goldHint: { color: PidroBevel.textGold, flexShrink: 1 },
  pinned: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  content: {
    minHeight: 0,
    flex: 1,
    gap: PidroSpacing.sm,
    paddingTop: PidroSpacing.xxs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.xs,
  },
  headerTitle: { flex: 1, minWidth: 0 },
  search: { flex: 1, minWidth: 0 },
  error: {
    borderColor: PidroColors.dangerBorder,
    padding: PidroSpacing.sm,
  },
  loading: {
    minHeight: 180,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: PidroSpacing.sm,
  },
  roomScroll: {
    minHeight: 0,
    flex: 1,
  },
  roomScrollContent: {
    gap: 16,
    paddingBottom: PidroSpacing.md,
  },
  section: {
    gap: 3,
  },
  sectionHeader: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: PidroSpacing.sm,
  },
  roomGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -5,
  },
  emptyState: {
    width: '100%',
    maxWidth: PidroLayout.contentMaxWidth,
    alignSelf: 'center',
    gap: PidroSpacing.sm,
    padding: PidroSpacing.md,
    paddingTop: PidroSpacing.lg,
  },
  emptyCopy: {
    gap: PidroSpacing.xxs,
  },
  emptyAction: {
    alignSelf: 'center',
  },
  emptyLobby: {
    flexGrow: 1,
    alignItems: 'center',
    gap: PidroSpacing.md,
    paddingTop: PidroSpacing.xs,
  },
  emptyLobbyLandscape: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: PidroSpacing.xl,
    paddingTop: 0,
  },
  // A tablet has room to spare: the whole stack sits together in the middle.
  emptyLobbyTablet: { justifyContent: 'center', paddingBottom: PidroSpacing.xxl },
  emptyChairs: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  emptyLobbyCopy: { gap: PidroSpacing.xs },
  emptyColumn: {
    width: '100%',
    maxWidth: 400,
    flexGrow: 1,
    gap: PidroSpacing.md,
  },
  emptyColumnLandscape: {
    flex: 1,
    maxWidth: 400,
    justifyContent: 'center',
    gap: PidroSpacing.sm,
  },
  emptySpacer: { flexGrow: 1 },
  grow0: { flexGrow: 0 },
  emptyActions: {
    alignItems: 'stretch',
    gap: PidroSpacing.sm,
  },
});
