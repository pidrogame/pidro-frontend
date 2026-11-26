import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useNetworkState } from 'expo-network';
import type { InvitePreview } from '@pidro/shared';
import { captureAnalytics } from '@/analytics/PostHogAnalytics';
import { adsApi } from '@/api/ads';
import { invitesApi } from '@/api/invites';
import { AuthProviderButtons } from '@/components/auth/AuthProviderButtons';
import { useProviderSignIn } from '@/components/auth/useProviderSignIn';
import { LogoGlow } from '@/components/home/LogoGlow';
import { FACES } from '@/components/ui/Avatar';
import { BevelButton } from '@/components/ui/BevelButton';
import { Icon } from '@/components/ui/Icon';
import { PidroLogo } from '@/components/ui/PidroLogo';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PidroText } from '@/components/ui/PidroText';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { PidroBevel, PidroColors, PidroFonts, PidroLayout, PidroSpacing } from '@/design/tokens';
import type { FirstScreen } from '@/features/auth/firstScreen';
import { forgetPlayer, readFirstScreen } from '@/features/auth/knownPlayer';
import type { SocialProviderAvailability } from '@/features/auth/socialCredentials';
import { getSocialProviderAvailability } from '@/features/auth/socialProviders';
import { createSoloRoom } from '@/features/game/solo';
import { useAuth } from '@/hooks/useAuth';
import { classifyInviteState } from '@/features/invites/joinFlow';
import { authenticatedEntryDestination } from '@/navigation/initialRoute';
import { gameRoute } from '@/navigation/gameRoute';
import { useAgeGateStore } from '@/stores/ageGate';
import { useAuthStore } from '@/stores/auth';
import { useLobbyStore } from '@/stores/lobby';
import { usePendingInviteStore } from '@/stores/pendingInvite';
import { useTranslation } from '@/i18n';
import { apiErrorInfo } from '@/utils/apiErrors';
import { Background } from '@/components/ui/Background';

type LaunchState =
  'idle' | 'creatingGuest' | 'creatingRoom' | 'roomFailed' | 'joiningInvite' | 'signingIn';

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ fixture?: string }>();
  // Apple and Facebook exist only on a device; the fixture shows their buttons anywhere.
  const fixtureProviders = __DEV__ && params.fixture === 'providers';
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
  const {
    isAuthenticated,
    user,
    continueAsGuest,
    signInWithProvider,
    isLoading,
    error: authError,
    clearError,
  } = useAuth();
  const providerSignIn = useProviderSignIn(signInWithProvider);
  const [screen, setScreen] = useState<FirstScreen | null>(null);
  const [providers, setProviders] = useState<SocialProviderAvailability | null>(null);
  const [launchState, setLaunchState] = useState<LaunchState>('idle');
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const launchBusy = launchState === 'creatingGuest' || launchState === 'creatingRoom';
  const doorsDisabled = offline || launchBusy || isLoading;

  // A phone someone signed in on greets them by name (PID-456).
  useEffect(() => {
    let active = true;
    void readFirstScreen().then((next) => active && setScreen(next));
    void getSocialProviderAvailability().then((next) => active && setProviders(next));
    return () => {
      active = false;
    };
  }, []);

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

  const signInDirectly = async (method: 'apple' | 'facebook') => {
    if (doorsDisabled) return;
    captureAnalytics('account_entry_tapped', { known: true });
    // Signed in, useProviderSignIn takes them on; the Redirect below must not as well.
    setLaunchState('signingIn');
    await providerSignIn.start(method);
    if (useAuthStore.getState().status !== 'authenticated') setLaunchState('idle');
  };

  if (isAuthenticated && launchState === 'idle') {
    return (
      <Background>
        {user ? (
          <Redirect href={authenticatedEntryDestination(pendingInvite, ageBand, user) as Href} />
        ) : null}
      </Background>
    );
  }

  // Until the phone has said whom it knows, and whether it offers their provider, the
  // logo's room is all there is: no Sign in that turns into Apple a moment later.
  const waitsForProviders =
    screen?.kind === 'known' && screen.player.method !== 'password' && !fixtureProviders;
  if (!screen || (waitsForProviders && !providers)) return <Background />;

  const known = screen.kind === 'known' ? screen.player : null;
  // Apple or Facebook signs in directly where this phone offers it; elsewhere, Sign in.
  const provider =
    known && known.method !== 'password' && (fixtureProviders || providers?.[known.method])
      ? known.method
      : null;
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

          {authError || launchError || providerSignIn.notice ? (
            <Surface variant="subtle" style={styles.error} accessibilityRole="alert">
              <PidroText role="metadata" tone="danger" align="center">
                {launchError ? t('auth.solo_failed') : (authError ?? providerSignIn.notice)}
              </PidroText>
            </Surface>
          ) : null}

          {known ? (
            <View testID="welcome-known" style={styles.known}>
              <PlayerAvatar
                uri={known.avatarUrl}
                fallbackSource={FACES[known.face ?? 'a']}
                size={tablet ? 72 : 60}
                accessibilityLabel={t('social.profile_picture')}
              />
              <View style={styles.knownCopy}>
                <PidroText role="body" tone="soft">
                  {t('auth.welcome_back')}
                </PidroText>
                <PidroText role="title" numberOfLines={1} style={tablet && styles.knownNameTablet}>
                  {known.name}
                </PidroText>
              </View>
            </View>
          ) : null}

          {provider ? (
            <AuthProviderButtons
              only={provider}
              showEmail={false}
              availability={
                fixtureProviders ? { apple: true, facebook: true } : (providers ?? undefined)
              }
              onApple={() => void signInDirectly('apple')}
              onFacebook={() => void signInDirectly('facebook')}
            />
          ) : known ? (
            <BevelButton
              testID="welcome-have-account"
              accessibilityLabel={t('auth.sign_in')}
              material="wood"
              size="md"
              fullWidth
              disabled={doorsDisabled}
              onPress={() => {
                captureAnalytics('account_entry_tapped', { known: true });
                router.push({
                  pathname: '/(auth)/login',
                  params: { email: known.name, focus: 'password' },
                });
              }}>
              <DoorLabel title={t('auth.sign_in')} wood tablet={tablet} />
            </BevelButton>
          ) : (
            // One door for every account, old or new: Sign in finds either (PID-455).
            <BevelButton
              testID="welcome-have-account"
              accessibilityLabel={`${t('auth.have_account')}. ${t('auth.have_account_detail')}.`}
              material="wood"
              size="md"
              fullWidth
              disabled={doorsDisabled}
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
          )}
          <BevelButton
            testID="welcome-quick-game"
            accessibilityLabel={`${t('auth.quick')}. ${t('auth.quick_detail')}.`}
            accessibilityState={{ busy: launchBusy }}
            material="glass"
            size="md"
            fullWidth
            disabled={doorsDisabled}
            onPress={launch}>
            <DoorLabel
              title={t('auth.quick')}
              detail={t('auth.quick_detail')}
              busy={launchBusy}
              tablet={tablet}
            />
          </BevelButton>

          {known ? (
            <TextLink
              label={t('auth.not_you')}
              size={tablet ? 16 : 15}
              disabled={doorsDisabled}
              testID="welcome-not-you"
              onPress={() => {
                setScreen({ kind: 'new' });
                void forgetPlayer();
              }}
            />
          ) : (
            <View style={styles.newHere}>
              <PidroText role="body" tone="soft">
                {t('auth.new_here')}
              </PidroText>
              <TextLink
                label={t('auth.create_free')}
                size={tablet ? 16 : 15}
                disabled={doorsDisabled}
                style={styles.newHereLink}
                onPress={() => router.push('/(auth)/register')}
              />
            </View>
          )}
        </View>
      </View>
    </ScreenShell>
  );
}

/** A door's name, and under it what it leads to; a spinner stands in while it opens. */
function DoorLabel({
  title,
  detail,
  busy = false,
  wood = false,
  tablet,
}: {
  title: string;
  detail?: string;
  busy?: boolean;
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
      {busy ? (
        <ActivityIndicator color={wood ? PidroBevel.textGold : PidroColors.text} />
      ) : detail ? (
        <PidroText
          align="center"
          maxFontSizeMultiplier={1.3}
          style={[styles.detail, wood && styles.woodDetail, tablet && styles.detailTablet]}>
          {detail}
        </PidroText>
      ) : null}
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
  // The greeting, a provider's button and the capped doors share one edge.
  actionsTablet: { maxWidth: 380, gap: PidroSpacing.lg },
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
  // Shrinks to the button, so a long name in "Continue as" wraps instead of running off.
  door: { flexShrink: 1, alignItems: 'center', gap: 2 },
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
  known: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.sm },
  knownCopy: { flex: 1, minWidth: 0 },
  knownNameTablet: { fontSize: 26, lineHeight: 32 },
  newHere: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newHereLink: { paddingHorizontal: 6 },
});
