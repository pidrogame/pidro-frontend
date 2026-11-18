import { useCallback, useEffect, useEffectEvent } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/auth';

/** Back out of a flow screen, even when a deep link opened it with no history. */
export function useFlowBack() {
  const router = useRouter();
  const signedIn = useAuthStore((state) => state.user != null);
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(signedIn ? '/home' : '/welcome');
  }, [router, signedIn]);
}

// A browser has no Back button: in development `__pidroBack()` presses it, as BackHandler would.
const webBack: (() => boolean)[] = [];
if (Platform.OS === 'web' && __DEV__)
  (globalThis as { __pidroBack?: () => boolean }).__pidroBack = () =>
    [...webBack].reverse().some((listener) => listener());

/**
 * Routes Android's hardware back (and the back gesture) through a screen's own
 * steps. While `enabled`, the press runs `onBack` instead of leaving the route.
 * The newest listener hears it first, so it subscribes again only when
 * `enabled` changes: a re-render must not jump ahead of a later screen step.
 */
export function useHardwareBack(enabled: boolean, onBack: () => void) {
  const back = useEffectEvent(onBack);
  useEffect(() => {
    if (!enabled) return;
    const listener = () => {
      back();
      return true;
    };
    if (Platform.OS === 'web' && __DEV__) {
      webBack.push(listener);
      return () => void webBack.splice(webBack.indexOf(listener), 1);
    }
    // Only Android has the button; the web shim logs an error if asked.
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', listener);
    return () => subscription.remove();
  }, [enabled]);
}
