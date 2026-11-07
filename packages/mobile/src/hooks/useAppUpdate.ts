import { useCallback, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { nativeApplicationVersion } from 'expo-application';
import * as Updates from 'expo-updates';
import { useLobbyStore } from '@/stores/lobby';
import { nativeStoreUpdate } from '@/features/appUpdate';

/** OTA updates run only in installed release builds, not Expo Go or web previews. */
export const updatesEnabled = Platform.OS !== 'web' && !__DEV__ && Updates.isEnabled;

let sessionDismissedStoreId: string | null = null;

/** The native store upgrade stays separate from automatic OTA startup updates. */
export function useAppUpdate({
  inGame,
  forcedStore = false,
}: {
  inGame: boolean;
  forcedStore?: boolean;
}) {
  const [dismissedStoreId, setDismissedStoreId] = useState(sessionDismissedStoreId);
  const [restarting, setRestarting] = useState(false);
  const inFlight = useRef(false);
  const minimums = useLobbyStore((state) => state.minimumNativeVersions);
  const storeUrls = useLobbyStore((state) => state.nativeStoreUrls);
  const storeUpdate = nativeStoreUpdate(
    forcedStore ? 'android' : Platform.OS,
    forcedStore ? '0.0.0' : nativeApplicationVersion,
    forcedStore ? { android: '99.0.0' } : minimums,
    forcedStore ? { android: 'https://example.invalid/pidro-store' } : storeUrls
  );
  const store = Boolean(storeUpdate && storeUpdate.id !== dismissedStoreId && !inGame);

  const restart = useCallback(async () => {
    if (inFlight.current || !store || !storeUpdate) return;
    inFlight.current = true;
    setRestarting(true);
    try {
      await Linking.openURL(storeUpdate.url);
    } catch {
      // A failed open leaves the notice available to try again.
    } finally {
      inFlight.current = false;
      setRestarting(false);
    }
  }, [store, storeUpdate]);

  const dismiss = useCallback(() => {
    if (!storeUpdate) return;
    sessionDismissedStoreId = storeUpdate.id;
    setDismissedStoreId(storeUpdate.id);
  }, [storeUpdate]);

  return { visible: store, store, restarting, restart, dismiss };
}
