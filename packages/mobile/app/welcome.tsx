import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Redirect, useRouter, type Href } from 'expo-router';
import { useNetworkState } from 'expo-network';
import type { InvitePreview } from '@pidro/shared';
import { captureAnalytics } from '@/analytics/PostHogAnalytics';
import { adsApi } from '@/api/ads';
import { invitesApi } from '@/api/invites';
import { LogoGlow } from '@/components/home/LogoGlow';
import { BevelButton } from '@/components/ui/BevelButton';
import { Icon } from '@/components/ui/Icon';
import { PidroLogo } from '@/components/ui/PidroLogo';
import { PidroText } from '@/components/ui/PidroText';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { PidroBevel, PidroColors, PidroFonts, PidroLayout, PidroSpacing } from '@/design/tokens';
import { createSoloRoom } from '@/features/game/solo';
import { useAuth } from '@/hooks/useAuth';
import { classifyInviteState } from '@/features/invites/joinFlow';
import { authenticatedEntryDestination } from '@/navigation/initialRoute';
import { gameRoute } from '@/navigation/gameRoute';
import { useAgeGateStore } from '@/stores/ageGate';
import { useLobbyStore } from '@/stores/lobby';
import { usePendingInviteStore } from '@/stores/pendingInvite';
import { useTranslation } from '@/i18n';
import { apiErrorInfo } from '@/utils/apiErrors';
import { Background } from '@/components/ui/Background';

type LaunchState = 'idle' | 'creatingGuest' | 'creatingRoom' | 'roomFailed' | 'joiningInvite';

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const compactLandscape = landscape && height < PidroLayout.compactHeight;
  const tablet = Math.min(width, height) >= 700;
  const network = useNetworkState();
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const pendingInvite = usePendingInviteStore((state) => state.pendingInvite);
  const ageBand = useAgeGateStore((state) => state.ageBand);
  const clearPendingInvite = usePendingInviteStore((state) => state.clearPendingInvite);
  const upsertLobbyRoom = useLobbyStore((state) => state.upsertLobbyRoom);
  const { isAuthenticated, user, continueAsGuest, error: authError, clearError } = useAuth();
  const [launchState, setLaunchState] = useState<LaunchState>('idle');
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const launchBusy = launchState === 'creatingGuest' || launchState === 'creatingRoom';

  useEffect(() => {
    if (!pendingInvite) return;
    let active = true;
    invitesApi
      .preview(pendingInvite.code)
      .then((preview) => {
        if (!active) return;
        // A dead invite would leave JOIN TABLE leading nowhere; show PLAY instead.
        if (classifyInviteState(preview.state) === 'terminal') clearPendingInvite();
        else setInvitePreview(preview);
      })
      .catch(() => {
        if (active) setInvitePreview(null);
      });
    return () => {
      active = false;
    };
  }, [clearPendingInvite, pendingInvite]);

  const startSolo = useCallback(async () => {
    setLaunchState('creatingRoom');
    setLaunchError(null);
    try {
      const response = await createSoloRoom().catch(async (error: unknown) => {
        // A first game has no sheet to offer an ad in: it never waits for one.
        if (apiErrorInfo(error).code !== 'AD_REQUIRED') throw error;
        await adsApi.unavailable();
        return createSoloRoom();
      });
      if (response.room) upsertLobbyRoom(response.room, 'my_rejoinable');
      router.replace(gameRoute(response.code, 'single-player'));
    } catch {
      setLaunchState('roomFailed');
      setLaunchError('auth.solo_failed');
    }
  }, [router, upsertLobbyRoom]);

  const launch = useCallback(async () => {
    if (launchBusy || offline) return;
    clearError();
    setLaunchError(null);

    if (launchState === 'roomFailed' && user) {
      await startSolo();
      return;
    }

    captureAnalytics('guest_chosen');
    setLaunchState('creatingGuest');
    const session = await continueAsGuest();
    if (!session) {
      setLaunchState('idle');
      return;
    }

    const destination = authenticatedEntryDestination(pendingInvite, ageBand, session.user);
    if (destination !== '/home') {
      setLaunchState('joiningInvite');
      router.replace(destination as Href);
      return;
    }

    await startSolo();
  }, [
    clearError,
    continueAsGuest,
    ageBand,
    launchBusy,
    launchState,
    offline,
    pendingInvite,
    router,
    startSolo,
    user,
  ]);

  if (isAuthenticated && launchState === 'idle') {
    return (
      <Background>
        {user ? (
          <Redirect href={authenticatedEntryDestination(pendingInvite, ageBand, user) as Href} />
        ) : null}
      </Background>
    );
  }

  const currentPreview =
    pendingInvite && invitePreview?.code === pendingInvite.code ? invitePreview : null;
  const inviter = currentPreview?.host || t('auth.friend');
  return (
    <ScreenShell
      testID="welcome-screen"
      scroll
      contentStyle={[
        styles.screen,
        compactLandscape ? styles.screenLandscape : tablet && styles.screenTablet,
      ]}>
      <View style={[styles.header, compactLandscape && styles.headerLandscape]}>
        <BevelButton
          accessibilityLabel={t('auth.settings')}
          material="glass"
          size="icon"
          onPress={() => router.push('/device-settings')}
          style={tablet && styles.settingsTablet}>
          <Icon name="settings" size={tablet ? 22 : 20} />
        </BevelButton>
      </View>
      <View style={compactLandscape ? styles.bodyLandscape : styles.body}>
        <View
          style={[styles.logoStage, compactLandscape && styles.logoStageLandscape]}
          pointerEvents="none">
          <LogoGlow size={tablet ? 700 : compactLandscape ? 360 : 420} />
          <PidroLogo size="hero" width={tablet ? 440 : compactLandscape ? 270 : 280} />
        </View>

        <View
          testID="welcome-window"
          style={[
            styles.actions,
            tablet && styles.actionsTablet,
            compactLandscape && styles.actionsLandscape,
          ]}>
          {pendingInvite ? (
            <Surface variant="card" style={styles.inviteCard}>
              <View style={styles.inviteAvatar}>
                <PidroText role="title" tone="gold">
                  {inviter.charAt(0).toUpperCase()}
                </PidroText>
              </View>
              <View style={styles.inviteCopy}>
                <PidroText role="label" numberOfLines={1}>
                  {t('auth.saved_seat', { name: inviter })}
                </PidroText>
              </View>
              <PidroText role="metadata" tone="cyan">
                {t('auth.invite_caps')}
              </PidroText>
            </Surface>
          ) : null}

          {offline ? (
            <Surface variant="subtle" style={styles.offline} accessibilityRole="alert">
              <PidroText role="metadata" tone="gold" align="center">
                {t('auth.offline')}
              </PidroText>
            </Surface>
          ) : null}

          {authError || launchError ? (
            <Surface variant="subtle" style={styles.error} accessibilityRole="alert">
              <PidroText role="metadata" tone="danger" align="center">
                {launchError ? t('auth.solo_failed') : authError}
              </PidroText>
            </Surface>
          ) : null}

          {/* One door for every account, old or new: Sign in finds either (PID-455). */}
          <BevelButton
            testID="welcome-have-account"
            accessibilityLabel={`${t('auth.have_account')}. ${t('auth.have_account_detail')}.`}
            material="wood"
            size="md"
            fullWidth
            disabled={offline || launchBusy}
            onPress={() => {
              captureAnalytics('account_entry_tapped');
              router.push('/(auth)/login');
            }}>
            <DoorLabel
              title={t('auth.have_account')}
              detail={t('auth.have_account_detail')}
              wood
              tablet={tablet}
            />
          </BevelButton>
          <BevelButton
            testID="welcome-quick-game"
            accessibilityLabel={`${t('auth.quick')}. ${t('auth.quick_detail')}.`}
            accessibilityState={{ busy: launchBusy }}
            material="glass"
            size="md"
            fullWidth
            disabled={offline || launchBusy}
            onPress={launch}>
            <DoorLabel
              title={t('auth.quick')}
              detail={launchBusy ? null : t('auth.quick_detail')}
              tablet={tablet}
            />
          </BevelButton>

          <View style={styles.newHere}>
            <PidroText role="body" tone="soft">
              {t('auth.new_here')}
            </PidroText>
            <TextLink
              label={t('auth.create_free')}
              size={tablet ? 16 : 15}
              disabled={offline || launchBusy}
              style={styles.newHereLink}
              onPress={() => router.push('/(auth)/register')}
            />
          </View>
        </View>
      </View>
    </ScreenShell>
  );
}

/** A door's name, and under it what it leads to; a spinner stands in while it opens. */
function DoorLabel({
  title,
  detail,
  wood = false,
  tablet,
}: {
  title: string;
  detail: string | null;
  wood?: boolean;
  tablet: boolean;
}) {
  return (
    <View style={styles.door}>
      <PidroText
        align="center"
        maxFontSizeMultiplier={1.3}
        style={[wood ? styles.woodTitle : styles.glassTitle, tablet && styles.titleTablet]}>
        {title}
      </PidroText>
      {detail ? (
        <PidroText
          align="center"
          maxFontSizeMultiplier={1.3}
          style={[styles.detail, wood && styles.woodDetail, tablet && styles.detailTablet]}>
          {detail}
        </PidroText>
      ) : (
        <ActivityIndicator color={wood ? PidroBevel.textGold : PidroColors.text} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: PidroSpacing.sm,
  },
  screenLandscape: { paddingVertical: PidroSpacing.md },
  screenTablet: { paddingHorizontal: PidroSpacing.xl, paddingVertical: PidroSpacing.xl },
  header: {
    width: '100%',
    height: 48,
    flexShrink: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerLandscape: { position: 'absolute', top: 16, right: 16, width: 44, zIndex: 1 },
  settingsTablet: { width: 48, minHeight: 48 },
  body: { width: '100%', flex: 1, alignItems: 'center', gap: 14 },
  bodyLandscape: {
    width: '100%',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: PidroSpacing.xxl,
  },
  logoStage: {
    width: '100%',
    flex: 1,
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoStageLandscape: {
    width: 340,
    alignSelf: 'stretch',
    flexShrink: 1,
  },
  actions: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'stretch',
    gap: 14,
  },
  actionsLandscape: { width: 330 },
  actionsTablet: { maxWidth: 480, gap: PidroSpacing.lg },
  inviteCard: {
    minHeight: 64,
    padding: PidroSpacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.sm,
  },
  inviteAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PidroColors.glass,
  },
  inviteCopy: { flex: 1, minWidth: 0 },
  offline: { padding: PidroSpacing.sm, borderColor: PidroColors.gold },
  error: { padding: PidroSpacing.sm },
  door: { alignItems: 'center', gap: 2 },
  woodTitle: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 25,
    lineHeight: 33,
    color: PidroBevel.textGold,
    ...PidroBevel.labelShadow,
    transform: [{ translateY: -1 }],
  },
  glassTitle: {
    fontFamily: PidroFonts.ui,
    fontWeight: '900',
    fontSize: 20,
    lineHeight: 26,
    color: PidroColors.text,
    ...PidroBevel.glassLabelShadow,
    transform: [{ translateY: -0.5 }],
  },
  titleTablet: { fontSize: 28, lineHeight: 36 },
  detail: {
    fontFamily: PidroFonts.ui,
    fontWeight: '700',
    fontSize: 15,
    lineHeight: 20,
    color: PidroColors.text,
  },
  woodDetail: { color: PidroColors.textOnWood },
  detailTablet: { fontSize: 17, lineHeight: 22 },
  newHere: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newHereLink: { paddingHorizontal: 6 },
});
