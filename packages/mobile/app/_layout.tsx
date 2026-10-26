import '../global.css';

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
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
import { useLocaleBootstrap } from '../src/i18n';
import { PidroColors } from '../src/design/tokens';

initSentry();
void SplashScreen.preventAutoHideAsync().catch(console.warn);
void SystemUI.setBackgroundColorAsync(PidroColors.feltBottom).catch(console.warn);

function hideSplash() {
  void SplashScreen.hideAsync().catch(console.warn);
}

export default function RootLayout() {
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

  if (fontError) throw fontError;
  const ready = fontsLoaded && authHydrated && ageGateHydrated && localeReady;

  return (
    // Keep the native felt mounted through hydration and overlay dismissal.
    <SafeAreaProvider>
      <Background>
        {ready ? (
          <View collapsable={false} style={styles.content} onLayout={hideSplash}>
            <AnalyticsProvider>
              <AnalyticsTracker />
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
            </AnalyticsProvider>
          </View>
        ) : null}
      </Background>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ content: { flex: 1 } });
