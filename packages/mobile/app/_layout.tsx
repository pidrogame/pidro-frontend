import '../global.css';

import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import * as Font from 'expo-font';
import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';
import { Stack, usePathname } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AnalyticsProvider, AnalyticsTracker } from '../src/analytics/PostHogAnalytics';
import { initRealtime } from '../src/bootstrap/realtime';
import { initSentry, reportFailure } from '../src/bootstrap/sentry';
import { canAccessProtectedRoutes } from '../src/navigation/initialRoute';
import { useAuthStore } from '../src/stores/auth';
import { useAgeGateStore } from '../src/stores/ageGate';
import { Background } from '../src/components/ui/Background';
import { WelcomeSheet } from '../src/components/news/WelcomeSheet';
import { LeagueHost } from '../src/components/league/LeagueHost';
import { useLocaleBootstrap } from '../src/i18n';
import { PidroColors } from '../src/design/tokens';
import { useStartupUpdate } from '../src/hooks/useStartupUpdate';
import { UpdatingScreen } from '../src/components/shell/UpdatingScreen';
import { UpdateRequiredScreen } from '../src/components/shell/UpdateRequiredScreen';
import { requiredStoreUpdate } from '../src/features/appUpdate';
import { useLobbyStore } from '../src/stores/lobby';
import { configurePurchases, syncPurchasesOnce } from '../src/features/premium/purchases';
import { refreshPremium } from '../src/features/premium/premium';
import { usePurchaserIdentity } from '../src/features/premium/usePurchaserIdentity';
import { listenForPush, registerPushIfGranted } from '../src/features/push/push';
import { settleFonts } from '../src/features/fonts';

initSentry();
configurePurchases();
// The first sync can bring a purchase from before sign-in: ask the server to look again.
void syncPurchasesOnce().then((synced) => {
  if (synced) void refreshPremium();
});
void SplashScreen.preventAutoHideAsync().catch(console.warn);
void SystemUI.setBackgroundColorAsync(PidroColors.feltBottom).catch(console.warn);

const FONTS = {
  Nunito: require('../assets/fonts/Nunito-VariableFont_wght.ttf'),
  BreeSerif: require('../assets/fonts/BreeSerif-Regular.ttf'),
  // Android takes each weight from its own static file (src/features/nunito.ts).
  ...(Platform.OS === 'android'
    ? {
        'Nunito-Medium': require('../assets/fonts/Nunito-Medium.ttf'),
        'Nunito-SemiBold': require('../assets/fonts/Nunito-SemiBold.ttf'),
        'Nunito-Bold': require('../assets/fonts/Nunito-Bold.ttf'),
        'Nunito-ExtraBold': require('../assets/fonts/Nunito-ExtraBold.ttf'),
        'Nunito-Black': require('../assets/fonts/Nunito-Black.ttf'),
      }
    : {}),
};

function hideSplash() {
  void SplashScreen.hideAsync().catch(console.warn);
}

export default function RootLayout() {
  const startupUpdate = useStartupUpdate();
  const localeReady = useLocaleBootstrap();
  const [fontsLoaded, fontError] = Font.useFonts(FONTS);
  // A font that fails costs its face, not the app: it starts once the rest have settled.
  const [fontsSettled, setFontsSettled] = useState(false);
  useEffect(() => {
    if (!fontError) return;
    reportFailure('Fonts', fontError);
    let active = true;
    void settleFonts(FONTS, Font).then((failed) => {
      failed.forEach((error) => reportFailure('Fonts', error));
      if (active) setFontsSettled(true);
    });
    return () => {
      active = false;
    };
  }, [fontError]);
  const fontsReady = fontsLoaded || fontsSettled;
  const authHydrated = useAuthStore((state) => state.hydrated);
  const authStatus = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const ageGateHydrated = useAgeGateStore((state) => state.hydrated);
  const ageBand = useAgeGateStore((state) => state.ageBand);
  const canAccessApp = canAccessProtectedRoutes(
    authHydrated,
    ageGateHydrated,
    authStatus,
    ageBand,
    user
  );
  const pathname = usePathname();
  const updateRequired = useLobbyStore((state) => state.updateRequired);
  const storeUrls = useLobbyStore((state) => state.nativeStoreUrls);
  // Every lobby join (cold start, return to foreground) brings it; a hand in play finishes first.
  const requiredUpdateUrl = requiredStoreUpdate(
    Platform.OS,
    { version: nativeApplicationVersion, build: nativeBuildVersion },
    updateRequired,
    storeUrls,
    pathname
  );
  const reduceMotion = useReducedMotion();
  const menuAnimation = reduceMotion ? 'none' : 'slide_from_right';

  useEffect(() => {
    initRealtime();
  }, []);
  usePurchaserIdentity();

  const ready = fontsReady && authHydrated && ageGateHydrated && localeReady;
  const routerMounted =
    ready && !startupUpdate.waiting && !startupUpdate.updating && !requiredUpdateUrl;
  const userId = user?.id;
  // Taps open their link once the Stack below is mounted.
  useEffect(() => (routerMounted ? listenForPush() : undefined), [routerMounted]);
  // No prompt in this build: only an install that already allows notifications registers.
  useEffect(() => {
    if (userId) void registerPushIfGranted(userId);
  }, [userId]);

  return (
    // Keep the native felt mounted through hydration and overlay dismissal.
    <SafeAreaProvider>
      {/* The browser tab's name; on iOS Head would also publish a Handoff activity. */}
      {Platform.OS === 'web' ? (
        <Head>
          <title>Pidro</title>
        </Head>
      ) : null}
      {/* On Android every screen is opaque over it once ready: kept loaded, not painted. */}
      <Background hidden={Platform.OS === 'android' && ready && !startupUpdate.waiting}>
        {fontsReady && localeReady && startupUpdate.updating ? (
          <View style={styles.content} onLayout={hideSplash}>
            <UpdatingScreen progress={startupUpdate.progress} />
          </View>
        ) : ready && !startupUpdate.waiting && requiredUpdateUrl ? (
          <View style={styles.content} onLayout={hideSplash}>
            <UpdateRequiredScreen url={requiredUpdateUrl} />
          </View>
        ) : ready && !startupUpdate.waiting ? (
          <View collapsable={false} style={styles.content} onLayout={hideSplash}>
            <AnalyticsProvider>
              <AnalyticsTracker />
              <LeagueHost>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    animation: 'none', // Instant transitions for game feel
                    // Keep the image visible while routes swap or the table loads.
                    contentStyle: { backgroundColor: 'transparent' },
                  }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="(onboarding)/age" />
                  <Stack.Screen name="welcome" />
                  <Stack.Screen name="device-settings" />
                  <Stack.Screen name="join-code" />
                  <Stack.Screen name="join/[code]" />
                  <Stack.Screen name="play/[slug]" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Protected guard={canAccessApp}>
                    <Stack.Screen name="(shell)" />
                    <Stack.Screen name="new-table" options={{ animation: 'none' }} />
                    <Stack.Screen
                      name="lobby"
                      options={{ animation: menuAnimation, gestureEnabled: !reduceMotion }}
                    />
                    <Stack.Screen
                      name="help"
                      options={{ animation: menuAnimation, gestureEnabled: !reduceMotion }}
                    />
                    <Stack.Screen
                      name="game"
                      options={{
                        animation: 'none',
                        gestureEnabled: false,
                      }}
                    />
                  </Stack.Protected>
                </Stack>
                <WelcomeSheet />
              </LeagueHost>
            </AnalyticsProvider>
          </View>
        ) : null}
      </Background>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ content: { flex: 1 } });
