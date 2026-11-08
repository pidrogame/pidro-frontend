import { useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { appUpdateFixture, channelLabel, runningUpdate } from '@/features/appUpdate';
import { updatesEnabled as enabled } from '@/hooks/useAppUpdate';
import { APP_CONFIG } from '@/constants/config';
import { PidroSpacing } from '@/design/tokens';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useGameStore } from '@/stores/game';
import { showTestAdRow, TestAdRow } from './TestAdRow';

export function AppUpdateSection() {
  const { t } = useTranslation();
  const { fixture } = useLocalSearchParams<{ fixture?: string }>();
  // A fixture shows a release build on web; its button never reaches Expo.
  const release = appUpdateFixture(fixture);
  // The web app has no build, channel or update: a reload is always the latest.
  const web = !release && Platform.OS === 'web';
  const about = release ?? {
    version: Application.nativeApplicationVersion ?? APP_CONFIG.version,
    build: Application.nativeBuildVersion,
    channel: Updates.channel,
    enabled,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    updateId: Updates.updateId,
    name: process.env.EXPO_PUBLIC_UPDATE_NAME,
    sha: process.env.EXPO_PUBLIC_UPDATE_SHA,
    date: process.env.EXPO_PUBLIC_UPDATE_DATE,
  };
  const running = runningUpdate(about);
  const { isUpdateAvailable, isUpdatePending, isChecking, isDownloading, isRestarting } =
    Updates.useUpdates();
  const [action, setAction] = useState<'check' | 'download' | 'restart' | null>(null);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const inGame = useGameStore((state) => Boolean(state.roomCode));
  const busy = action !== null || isChecking || isDownloading || isRestarting;

  async function handleUpdate() {
    if (!enabled || busy || inFlight.current) return;
    if (isUpdatePending && useGameStore.getState().roomCode) return;
    inFlight.current = true;
    const nextAction = isUpdatePending ? 'restart' : isUpdateAvailable ? 'download' : 'check';
    setAction(nextAction);
    setMessage(null);
    setError(false);
    try {
      if (nextAction === 'restart') {
        await Updates.reloadAsync();
        // Expo resolves before the runtime reloads. Keep the control locked.
        return;
      } else if (nextAction === 'download') {
        const result = await Updates.fetchUpdateAsync();
        if (!result.isNew && !result.isRollBackToEmbedded) {
          setError(true);
          setMessage('update.downloadError');
        }
      } else {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable && !result.isRollBackToEmbedded) {
          setMessage('update.latest');
        }
      }
    } catch {
      setError(true);
      setMessage(nextAction === 'restart' ? 'update.restartError' : 'update.serviceError');
    }
    inFlight.current = false;
    setAction(null);
  }

  const status = !about.enabled
    ? 'update.disabled'
    : action === 'restart' || isRestarting
      ? 'update.restarting'
      : isDownloading || action === 'download'
        ? 'update.downloading'
        : isChecking || action === 'check'
          ? 'update.checking'
          : error
            ? message
            : isUpdatePending
              ? 'update.pending'
              : isUpdateAvailable
                ? 'update.available'
                : (message ?? 'update.prompt');

  return (
    <Surface variant="window" padded style={styles.panel} testID="app-update-section">
      <PidroText role="label">{t('update.title')}</PidroText>
      <Surface variant="subtle" style={styles.details}>
        <View style={styles.versionRow}>
          <PidroText role="metadata" tone="muted">
            {t('update.version')}
          </PidroText>
          <PidroText role="metadata" selectable>
            {about.version ?? t('update.unavailable')}
          </PidroText>
        </View>
        {web ? null : (
          <>
            <View style={styles.versionRow}>
              <PidroText role="metadata" tone="muted">
                {t('update.build')}
              </PidroText>
              <PidroText role="metadata" selectable>
                {about.build ?? t('update.unavailable')}
              </PidroText>
            </View>
            <View style={styles.versionRow}>
              <PidroText role="metadata" tone="muted">
                {t('update.channel')}
              </PidroText>
              <PidroText role="metadata" selectable>
                {channelLabel(about.channel)}
              </PidroText>
            </View>
            <View style={styles.versionRow}>
              <PidroText role="metadata" tone="muted">
                {t('update.running')}
              </PidroText>
              <PidroText role="metadata" selectable testID="app-update-running">
                {running.label}
              </PidroText>
            </View>
            {running.detail ? (
              <PidroText role="metadata" tone="muted" selectable>
                {running.detail}
              </PidroText>
            ) : null}
          </>
        )}
      </Surface>
      {web ? null : (
        <PidroText
          role="metadata"
          tone={error ? 'danger' : 'muted'}
          accessibilityLiveRegion="polite">
          {status ? t(status) : null}
        </PidroText>
      )}
      {about.enabled && (
        <BevelButton
          label={
            isUpdatePending
              ? t('update.apply')
              : isUpdateAvailable
                ? t('update.download')
                : t('update.check')
          }
          material={isUpdatePending || isUpdateAvailable ? 'wood' : 'glass'}
          fullWidth
          loading={busy}
          disabled={isUpdatePending && inGame}
          onPress={handleUpdate}
        />
      )}
      {showTestAdRow ? <TestAdRow /> : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  panel: { gap: PidroSpacing.sm },
  details: { padding: PidroSpacing.sm, gap: PidroSpacing.xs },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: PidroSpacing.xs,
  },
});
