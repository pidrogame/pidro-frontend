import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SeatInvitations } from '@/components/invites/SeatInvitations';
import { friendNoticeFixture } from '@/features/friends/fixtures';
import { unnoticedInvitations } from '@/features/invites/tableInvitation';
import { seatInvitationsFixture } from '@/features/lobby/fixtures';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { publicPlayerName, type ProfileIdentity } from '@pidro/shared';
import { lobbyApi } from '@/api/lobby';
import { useLobbyChannel } from '@/channels/hooks/useLobbyChannel';
import { AuthSheet, type AuthSheetReason } from '@/components/auth/AuthSheet';
import { ClassicPlaque } from '@/components/home/ClassicPlaque';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { LogoGlow } from '@/components/home/LogoGlow';
import { useNoticeInset, usePillClearance } from '@/components/shell/TabPill';
import { UpdateNoticeSlot } from '@/components/shell/UpdateNotice';
import { Background } from '@/components/ui/Background';
import { BevelButton } from '@/components/ui/BevelButton';
import { CountBadge } from '@/components/ui/CountBadge';
import { HomeTileButton, type HomeTileSize } from '@/components/ui/HomeTileButton';
import { Icon } from '@/components/ui/Icon';
import { PidroLogo } from '@/components/ui/PidroLogo';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { StillLayer } from '@/components/ui/StillLayer';
import { Surface } from '@/components/ui/Surface';
import { PidroBevel, PidroColors, PidroLayout, PidroSpacing } from '@/design/tokens';
import { useProfileIdentity } from '@/hooks/useProfileIdentity';
import { useWaitingCount } from '@/hooks/useWaitingCount';
import { TABLE_UNKNOWN_ERROR, useQuickGame } from '@/hooks/useQuickGame';
import { useAuthStore } from '@/stores/auth';
import { useFriendsStore } from '@/stores/friends';
import { useLobbyStore } from '@/stores/lobby';
import { formatNumber, useTranslation } from '@/i18n';

type LobbyCountState = 'loading' | 'ready' | 'failed';

const LANDSCAPE_GUTTER = 56;

export default function HomeScreen() {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const compactLandscape = landscape && height < PidroLayout.compactHeight;
  const tablet = Math.min(width, height) >= 700;
  const tileSize: HomeTileSize = tablet ? 'tablet' : compactLandscape ? 'landscape' : 'phone';
  const params = useLocalSearchParams<{ fixture?: string }>();
  const fixture = __DEV__ ? params.fixture : undefined;
  const waiting = useWaitingCount(fixture);
  const fixtureInvitations = seatInvitationsFixture(fixture);
  const user = useAuthStore((state) => state.user);
  const storedInvitations = useAuthStore((state) => state.seatInvitations);
  const storedNotices = useFriendsStore((state) => state.notices);
  const notices = friendNoticeFixture(fixture) ?? storedNotices;
  const invitations = unnoticedInvitations(fixtureInvitations ?? storedInvitations, notices);
  // Keep the inbox mounted to show a last-seat-gone notice after its row disappears.
  const [showInvitations, setShowInvitations] = useState(invitations.length > 0);
  if (invitations.length > 0 && !showInvitations) setShowInvitations(true);
  const guest = Boolean(user?.guest);
  const lobby = useLobbyStore((state) => state.lobby);
  const setLobby = useLobbyStore((state) => state.setLobby);
  const setStats = useLobbyStore((state) => state.setStats);
  const router = useRouter();
  const [accountSheetReason, setAccountSheetReason] = useState<AuthSheetReason | null>(null);
  const [identity, setIdentity] = useState<ProfileIdentity | null>(null);
  const [lobbyCountState, setLobbyCountState] = useState<LobbyCountState>('loading');
  const refreshIdentity = useProfileIdentity();
  // Update notices use the logo slot; friend notices reserve space above the pill.
  // The invitations scroll already adds the floating notice's inset itself.
  const rawPillClearance = usePillClearance({ notice: !showInvitations });
  const noticeInset = useNoticeInset();
  const pillClearance = guest ? { bottom: 0, right: 0 } : rawPillClearance;
  const playerName = publicPlayerName(user?.username, t('social.player'), user?.display_name);
  const quickGame = useQuickGame(fixture === 'table-unknown' ? TABLE_UNKNOWN_ERROR : null);

  useLobbyChannel(
    useCallback(() => {
      if (!guest) setLobbyCountState('ready');
    }, [guest])
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void refreshIdentity()
        .then((nextIdentity) => {
          if (active && nextIdentity) setIdentity(nextIdentity);
        })
        .catch(() => undefined);

      if (!guest) {
        setLobbyCountState('loading');
        void lobbyApi
          .listLobby()
          .then((response) => {
            if (!active) return;
            setLobby(response.lobby);
            setStats({ active_games: response.rooms.length });
            setLobbyCountState('ready');
          })
          .catch(() => {
            if (active) setLobbyCountState('failed');
          });
      }

      return () => {
        active = false;
      };
    }, [guest, refreshIdentity, setLobby, setStats])
  );

  const games = identity?.games_played;
  const level = identity?.veteran?.level;
  const gamesLabel = t('social.games', { count: games ?? 0, number: formatNumber(games ?? 0) });
  const identityMeta = guest
    ? games != null
      ? t('social.guest_games', { games: gamesLabel })
      : t('social.guest')
    : games != null && level != null
      ? t('social.games_level', { games: gamesLabel, level: formatNumber(level) })
      : null;
  const onlineStatus =
    lobbyCountState !== 'ready'
      ? undefined
      : lobby.open_tables.length > 0
        ? t('social.tables_open', {
            count: lobby.open_tables.length,
            number: formatNumber(lobby.open_tables.length),
          })
        : t('social.start');

  // Drawn once on Android: only the rays turn on Home, and they repaint the window.
  const topBar = (
    <StillLayer bleed={20} style={styles.still}>
      <View testID="home-header" style={[styles.topBar, tablet && styles.topBarTablet]}>
        <PressableFX
          accessibilityRole="button"
          accessibilityLabel={
            waiting > 0
              ? `${t('social.open_profile')}, ${t('friend_notice.badge', { count: waiting })}`
              : t('social.open_profile')
          }
          onPress={() => router.push('/profile')}
          style={styles.identity}>
          <View>
            <PlayerAvatar
              uri={user?.avatar_url}
              size={tablet ? 56 : compactLandscape ? 44 : 48}
              level={level}
              accessibilityLabel={t('social.profile_picture')}
            />
            {waiting > 0 ? (
              <View testID="home-waiting-count" pointerEvents="none" style={styles.waitingBadge}>
                <CountBadge count={waiting} size="sm" />
              </View>
            ) : null}
          </View>
          <View style={styles.identityCopy}>
            <PidroText
              style={[styles.playerName, tablet && styles.playerNameTablet]}
              numberOfLines={1}>
              {playerName}
            </PidroText>
            {identityMeta ? (
              <View style={styles.identityMeta}>
                <PidroText role="metadata" tone="soft" style={tablet && styles.identityMetaTablet}>
                  {identityMeta}
                </PidroText>
                {guest ? (
                  <Icon name="chevron-right" size={14} color={PidroColors.textSoft} />
                ) : null}
              </View>
            ) : null}
          </View>
        </PressableFX>
        {guest ? (
          <View style={styles.identityMeta}>
            <BevelButton
              label={t('social.friends')}
              material="glass"
              size="sm"
              onPress={() => router.push('/friends')}
            />
            <BevelButton
              accessibilityLabel={t('social.settings')}
              material="glass"
              size="icon"
              onPress={() => router.push('/settings')}
              style={tablet && styles.settingsTablet}>
              <Icon name="settings" size={tablet ? 22 : 20} />
            </BevelButton>
          </View>
        ) : null}
      </View>
    </StillLayer>
  );

  const logoStage = (
    <View
      style={[
        styles.logoStage,
        compactLandscape && styles.logoStageLandscape,
        noticeInset > 0 && styles.logoWithNotice,
      ]}
      pointerEvents="box-none">
      <LogoGlow size={tablet ? 700 : compactLandscape ? 360 : 420} />
      {/* A tight stage lets the mark overflow toward the header; it never takes a tap. */}
      <View pointerEvents="none">
        <PidroLogo size="hero" width={tablet ? 440 : compactLandscape ? 270 : 280} />
      </View>
      <UpdateNoticeSlot style={compactLandscape && styles.noticeLandscape} />
    </View>
  );

  const actions = (
    <StillLayer
      bleed={32}
      style={[styles.still, (showInvitations || compactLandscape) && styles.stillStart]}>
      <View
        style={[
          styles.actions,
          tablet && styles.actionsTablet,
          compactLandscape && styles.actionsLandscape,
        ]}>
        {quickGame.error ? (
          <Surface variant="subtle" style={styles.error} accessibilityRole="alert">
            <PidroText role="metadata" tone="danger" align="center">
              {quickGame.error}
            </PidroText>
          </Surface>
        ) : null}

        <View style={[styles.tiles, tablet && styles.tilesTablet]}>
          <HomeTileButton
            material={guest ? 'wood' : 'glass'}
            icon={
              <Icon
                name="bot"
                size={tablet ? 40 : compactLandscape ? 28 : 30}
                color={guest ? PidroBevel.textGold : PidroColors.iconOnGlass}
              />
            }
            title={t('social.quick_game')}
            subtitle={t('social.three_bots')}
            status={guest ? t('social.no_signup') : undefined}
            size={tileSize}
            loading={quickGame.loading}
            onPress={quickGame.start}
            testID="home-quick-game"
            style={!guest && compactLandscape && noticeInset === 0 && styles.accountLandscapeTile}
          />
          <HomeTileButton
            material={guest ? 'glass' : 'wood'}
            icon={
              <Icon
                name="friends"
                size={tablet ? 40 : compactLandscape ? 28 : 30}
                color={guest ? PidroColors.iconOnGlass : PidroBevel.textGold}
              />
            }
            title={t('social.play_online')}
            subtitle={t('social.real_players')}
            status={guest ? t('social.free_account') : onlineStatus}
            size={tileSize}
            onPress={() => {
              if (guest) setAccountSheetReason('multiplayer');
              else router.push('/lobby');
            }}
            testID="home-play-online"
            style={!guest && compactLandscape && noticeInset === 0 && styles.accountLandscapeTile}
          />
        </View>

        {guest ? (
          <>
            <ClassicPlaque onPress={() => router.push('/(auth)/claim-classic')} />
            <View style={styles.accountLinks}>
              <PidroText role="metadata" tone="soft" style={tablet && styles.accountTextTablet}>
                {t('social.have_account')}
              </PidroText>
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push('/(auth)/login')}
                style={styles.accountLink}>
                <PidroText
                  role="metadata"
                  tone="cyan"
                  style={[styles.signIn, tablet && styles.accountTextTablet]}>
                  {t('social.sign_in')}
                </PidroText>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </StillLayer>
  );

  return (
    <Background>
      <View style={styles.scrim}>
        <SafeAreaView
          testID="home-screen"
          style={styles.safe}
          edges={
            guest
              ? ['top', 'left', 'right', 'bottom']
              : compactLandscape
                ? ['top', 'left', 'bottom']
                : ['top', 'left', 'right']
          }>
          <View
            style={[
              styles.main,
              tablet && styles.mainTablet,
              compactLandscape && styles.mainLandscape,
              !compactLandscape && {
                paddingBottom:
                  tablet && landscape ? Math.max(56, pillClearance.bottom) : pillClearance.bottom,
              },
              compactLandscape && noticeInset > 0 && { paddingBottom: noticeInset },
              compactLandscape && !guest && { paddingRight: pillClearance.right },
            ]}>
            {topBar}
            {showInvitations ? (
              <ScrollView
                style={styles.invitationScroll}
                contentContainerStyle={[
                  styles.invitationContent,
                  { paddingBottom: PidroSpacing.md + noticeInset },
                ]}>
                <SeatInvitations fixture={fixtureInvitations} noticed={notices} />
                {actions}
              </ScrollView>
            ) : compactLandscape ? (
              <View style={styles.bodyLandscape}>
                {logoStage}
                <ScrollView
                  style={styles.actionsScroll}
                  contentContainerStyle={styles.actionsScrollContent}
                  showsVerticalScrollIndicator={false}>
                  {actions}
                </ScrollView>
              </View>
            ) : (
              <>
                {logoStage}
                {actions}
              </>
            )}
          </View>
        </SafeAreaView>
      </View>
      <AuthSheet
        isOpen={accountSheetReason != null}
        reason={accountSheetReason ?? 'save'}
        onClose={() => setAccountSheetReason(null)}
        onSaved={() => {
          const shouldFindTable = accountSheetReason === 'multiplayer';
          setAccountSheetReason(null);
          if (shouldFindTable) router.push('/lobby');
        }}
        onClaimClassic={() => {
          setAccountSheetReason(null);
          router.push('/(auth)/claim-classic');
        }}
        onJoinCode={() => {
          setAccountSheetReason(null);
          router.push('/join-code');
        }}
      />
    </Background>
  );
}

const styles = StyleSheet.create({
  invitationScroll: { flex: 1, width: '100%', maxWidth: 794 },
  invitationContent: { gap: PidroSpacing.md },
  scrim: { flex: 1, backgroundColor: PidroColors.screenScrim },
  safe: { flex: 1 },
  main: {
    flex: 1,
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 25,
    paddingTop: PidroSpacing.md,
    paddingBottom: PidroSpacing.lg,
  },
  mainTablet: { gap: PidroSpacing.lg, paddingHorizontal: 48, paddingTop: 48, paddingBottom: 56 },
  mainLandscape: { paddingHorizontal: LANDSCAPE_GUTTER, paddingVertical: PidroSpacing.md, gap: 6 },
  // Each layer holds its child where the parent did: centered in the column, at the start in a scroll.
  still: { alignSelf: 'stretch', alignItems: 'center', flexShrink: 0 },
  stillStart: { alignItems: 'flex-start' },
  topBar: {
    width: '100%',
    maxWidth: 794,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: PidroSpacing.sm,
    flexShrink: 0,
  },
  topBarTablet: { gap: 14 },
  waitingBadge: { position: 'absolute', top: 0, right: -PidroSpacing.xxs },
  identity: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.sm,
    minHeight: 48,
  },
  identityCopy: { minWidth: 0, flexShrink: 1 },
  playerName: { fontSize: 17, lineHeight: 22, fontWeight: '800', color: PidroColors.text },
  playerNameTablet: { fontSize: 20, lineHeight: 26 },
  identityMeta: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.xxs },
  identityMetaTablet: { fontSize: 14, lineHeight: 18 },
  settingsTablet: { width: 48, minHeight: 48 },
  logoStage: {
    width: '100%',
    flex: 1,
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoStageLandscape: { width: 340, alignSelf: 'stretch', flexShrink: 1 },
  logoWithNotice: { minHeight: 0 },
  // A small phone's logo column is too narrow for the notice: it also takes the
  // side gutter and the gap, stopping short of the tiles.
  noticeLandscape: {
    left: PidroSpacing.md - LANDSCAPE_GUTTER,
    right: PidroSpacing.xs - PidroSpacing.xxl,
  },
  bodyLandscape: {
    width: '100%',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: PidroSpacing.xxl,
  },
  actions: { width: '100%', maxWidth: 340, alignItems: 'stretch', gap: 14, flexShrink: 0 },
  actionsLandscape: { width: 330, gap: 10 },
  // A guest's column can be taller than the space beside the logo once there are
  // insets. Bound it there so it scrolls under the header instead of covering it;
  // the bleed into the gap and the bottom padding keeps the tiles' shadows unclipped
  // and stops short of the notice.
  actionsScroll: {
    alignSelf: 'stretch',
    flexGrow: 0,
    marginHorizontal: -PidroSpacing.xs,
    marginBottom: -PidroSpacing.md,
  },
  actionsScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: PidroSpacing.xs,
    paddingBottom: PidroSpacing.md,
  },
  actionsTablet: { maxWidth: 480, gap: PidroSpacing.lg },
  tiles: { width: '100%', flexDirection: 'row', gap: PidroSpacing.sm },
  tilesTablet: { gap: PidroSpacing.md },
  accountLandscapeTile: { minHeight: 170 },
  error: { borderColor: PidroColors.dangerBorder, padding: PidroSpacing.sm },
  accountLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  accountLink: {
    minHeight: PidroLayout.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: PidroSpacing.xs,
  },
  signIn: { fontWeight: '800' },
  accountTextTablet: { fontSize: 17, lineHeight: 22 },
});
