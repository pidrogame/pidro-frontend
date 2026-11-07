import '../global.css';

import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AnalyticsProvider, AnalyticsTracker } from '../src/analytics/PostHogAnalytics';
import { initRealtime } from '../src/bootstrap/realtime';
import { initSentry } from '../src/bootstrap/sentry';
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
import { configurePurchases, syncPurchasesOnce } from '../src/features/premium/purchases';
import { refreshPremium } from '../src/features/premium/premium';
import { usePurchaserIdentity } from '../src/features/premium/usePurchaserIdentity';
import { listenForPush, registerPushIfGranted } from '../src/features/push/push';

initSentry();
configurePurchases();
// The first sync can bring a purchase from before sign-in: ask the server to look again.
void syncPurchasesOnce().then((synced) => {
  if (synced) void refreshPremium();
});
void SplashScreen.preventAutoHideAsync().catch(console.warn);
void SystemUI.setBackgroundColorAsync(PidroColors.feltBottom).catch(console.warn);

function hideSplash() {
  void SplashScreen.hideAsync().catch(console.warn);
}

export default function RootLayout() {
  const startupUpdate = useStartupUpdate();
  const localeReady = useLocaleBootstrap();
  const [fontsLoaded, fontError] = useFonts({
    Nunito: require('../assets/fonts/Nunito-VariableFont_wght.ttf'),
    BreeSerif: require('../assets/fonts/BreeSerif-Regular.ttf'),
  });
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
  const reduceMotion = useReducedMotion();
  const menuAnimation = reduceMotion ? 'none' : 'slide_from_right';

  useEffect(() => {
    initRealtime();
  }, []);
  usePurchaserIdentity();

  const ready = fontsLoaded && authHydrated && ageGateHydrated && localeReady;
  const routerMounted = ready && !startupUpdate.waiting && !startupUpdate.updating;
  const userId = user?.id;
  // Taps open their link once the Stack below is mounted.
  useEffect(() => (routerMounted ? listenForPush() : undefined), [routerMounted]);
  // No prompt in this build: only an install that already allows notifications registers.
  useEffect(() => {
    if (userId) void registerPushIfGranted(userId);
  }, [userId]);

  if (fontError) throw fontError;

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
        {fontsLoaded && localeReady && startupUpdate.updating ? (
          <View style={styles.content} onLayout={hideSplash}>
            <UpdatingScreen progress={startupUpdate.progress} />
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
