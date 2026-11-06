import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { nativeApplicationVersion } from 'expo-application';
import * as Updates from 'expo-updates';
import { useLobbyStore } from '@/stores/lobby';
import {
  nativeStoreUpdate,
  pendingUpdateId,
  shouldCheckOnForeground,
  shouldShowUpdateNotice,
} from '@/features/appUpdate';

/** OTA updates run only in installed release builds, not Expo Go or web previews. */
export const updatesEnabled = Platform.OS !== 'web' && !__DEV__ && Updates.isEnabled;

// A dismissal lasts for this app session, across shell remounts (sign out, sign in).
let sessionDismissedUpdateId: string | null = null;
let sessionDismissedStoreId: string | null = null;

/**
 * The shell's update notice: whether it shows, and Restart / dismiss. Also
 * checks quietly when the app comes back to the foreground. Mount once.
 * `forced` is the dev fixture: the notice shows and Restart only goes busy.
 */
export function useAppUpdate({
  inGame,
  forced = false,
  forcedStore = false,
}: {
  inGame: boolean;
  forced?: boolean;
  forcedStore?: boolean;
}) {
  const {
    isUpdatePending,
    downloadedUpdate,
    isChecking,
    isDownloading,
    isRestarting,
    lastCheckForUpdateTimeSinceRestart,
  } = Updates.useUpdates();
  const [dismissedUpdateId, setDismissedUpdateId] = useState(sessionDismissedUpdateId);
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

  const pending = {
    enabled: updatesEnabled,
    isUpdatePending,
    downloadedUpdateId: downloadedUpdate?.updateId,
  };
  const updateId = forced ? 'fixture' : pendingUpdateId(pending);
  const visible =
    store ||
    (forced
      ? dismissedUpdateId !== updateId
      : shouldShowUpdateNotice({ ...pending, dismissedUpdateId, inGame }));

  const busy = isChecking || isDownloading;
  const lastCheckedAt = lastCheckForUpdateTimeSinceRestart?.getTime();
  // Expo publishes its state after the fact; this counts a check from the moment it starts.
  const lastStartedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!updatesEnabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const now = Date.now();
      const last = Math.max(lastCheckedAt ?? 0, lastStartedAt.current ?? 0) || null;
      if (!shouldCheckOnForeground({ enabled: true, busy, now, lastCheckedAt: last })) return;
      lastStartedAt.current = now;
      // Quiet: a failed check waits for the next foreground; the notice is the only UI.
      Updates.checkForUpdateAsync()
        .then((result) =>
          result.isAvailable || result.isRollBackToEmbedded ? Updates.fetchUpdateAsync() : null
        )
        .catch(() => {});
    });
    return () => subscription.remove();
  }, [busy, lastCheckedAt]);

  const restart = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRestarting(true);
    if (store && storeUpdate) {
      try {
        await Linking.openURL(storeUpdate.url);
      } catch {
        // A failed open leaves the notice available to try again.
      } finally {
        inFlight.current = false;
        setRestarting(false);
      }
      return;
    }
    if (forced) return;
    try {
      await Updates.reloadAsync();
      // Expo resolves before the runtime reloads. Keep the control locked.
    } catch {
      inFlight.current = false;
      setRestarting(false);
    }
  }, [forced, store, storeUpdate]);

  const dismiss = useCallback(() => {
    if (store && storeUpdate) {
      sessionDismissedStoreId = storeUpdate.id;
      setDismissedStoreId(storeUpdate.id);
      return;
    }
    sessionDismissedUpdateId = updateId;
    setDismissedUpdateId(updateId);
  }, [updateId, store, storeUpdate]);

  return { visible, store, restarting: restarting || isRestarting, restart, dismiss };
}
