import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STARTUP_UPDATE_LIMIT_MS, startupUpdateDecision } from '@/features/appUpdate';
import { updatesEnabled } from '@/hooks/useAppUpdate';
import { useGameStore } from '@/stores/game';

/** Mount only at the root, before routes. No foreground reloads or retries. */
export function useStartupUpdate() {
  const update = Updates.useUpdates();
  const enabled = updatesEnabled && !Updates.isEmergencyLaunch && update.restartCount === 0;
  const [waiting, setWaiting] = useState(enabled);
  const [fetching, setFetching] = useState(false);
  const [launchChecked, setLaunchChecked] = useState(!enabled);
  const startedAt = useRef(0);
  const finished = useRef(!enabled);
  const started = useRef(false);
  const reloading = useRef(false);
  const inGame = useGameStore((state) => Boolean(state.roomCode));

  useEffect(() => {
    startedAt.current = Date.now();
    const finish = () => {
      if (reloading.current) return;
      finished.current = true;
      setWaiting(false);
    };
    const timer = setTimeout(finish, STARTUP_UPDATE_LIMIT_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') finish();
    });
    if (enabled) {
      // Native already launched a cached download. Do not make that first run wait on network again.
      void AsyncStorage.getItem('app-update:last-launch')
        .then((previous) => {
          if (Updates.updateId) {
            if (!Updates.isEmbeddedLaunch && previous !== Updates.updateId) finish();
            void AsyncStorage.setItem('app-update:last-launch', Updates.updateId).catch(() => {});
          }
        })
        .catch(() => {})
        .finally(() => setLaunchChecked(true));
    }
    return () => {
      clearTimeout(timer);
      subscription.remove();
      finished.current = true;
    };
  }, [enabled]);

  useEffect(() => {
    const finish = () => {
      if (reloading.current) return;
      finished.current = true;
      setWaiting(false);
    };
    const decision = (pending: boolean) =>
      startupUpdateDecision({
        enabled,
        inGame: Boolean(useGameStore.getState().roomCode),
        finished: finished.current || AppState.currentState === 'background',
        pending,
        elapsedMs: Date.now() - startedAt.current,
      });
    const reload = async () => {
      if (reloading.current) return;
      if (decision(true) !== 'reload') return finish();
      reloading.current = true;
      try {
        await Updates.reloadAsync();
      } catch {
        reloading.current = false;
        finish();
      }
    };
    if (!launchChecked) return;
    if (decision(update.isUpdatePending) === 'continue') {
      finish();
      return;
    }
    if (update.isUpdatePending) {
      void reload();
      return;
    }
    // Let Expo's unchanged native startup procedure finish rather than race its fetch.
    if (
      started.current ||
      update.isStartupProcedureRunning ||
      update.isChecking ||
      update.isDownloading
    )
      return;
    started.current = true;
    void (async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable && !result.isRollBackToEmbedded) return finish();
        setFetching(true);
        const fetched = await Updates.fetchUpdateAsync();
        if (fetched.isNew || fetched.isRollBackToEmbedded) await reload();
        else finish();
      } catch {
        finish();
      }
    })();
  }, [
    enabled,
    launchChecked,
    inGame,
    update.isUpdatePending,
    update.isStartupProcedureRunning,
    update.isChecking,
    update.isDownloading,
  ]);

  return {
    waiting,
    updating: waiting && (fetching || update.isDownloading || update.isUpdatePending),
    progress: update.isUpdatePending ? 1 : (update.downloadProgress ?? 0),
  };
}
