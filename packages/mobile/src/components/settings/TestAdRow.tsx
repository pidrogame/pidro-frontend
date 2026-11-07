import { useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { PidroSpacing } from '@/design/tokens';
import {
  ensureAdsConsent,
  lastAdError,
  loadRewarded,
  showRewarded,
  startAds,
  type RewardedResult,
} from '@/features/ads/ads';

/** Development builds only: runs the whole rewarded-ad path on a phone. English on purpose. */
export const showTestAdRow = __DEV__ || Constants.expoConfig?.extra?.variant === 'development';

async function attempt(): Promise<RewardedResult> {
  // Google's order: consent first, then start the SDK.
  if (!(await ensureAdsConsent())) return 'unavailable';
  if ((await startAds()) === 'unavailable') return 'unavailable';
  if ((await loadRewarded()) === 'unavailable') return 'unavailable';
  return showRewarded();
}

export function TestAdRow() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    const outcome = await attempt();
    const error = outcome === 'unavailable' ? (lastAdError() ?? 'Ads may not be requested') : null;
    setResult(error ? `${outcome}: ${error}` : outcome);
    setBusy(false);
  }

  return (
    <Surface
      variant="subtle"
      style={Platform.OS === 'web' ? styles.line : styles.row}
      testID="settings-test-ad">
      {Platform.OS === 'web' ? (
        <>
          <PidroText role="label">Show a test ad</PidroText>
          <PidroText role="metadata" tone="muted">
            Ads need a phone
          </PidroText>
        </>
      ) : (
        <>
          <BevelButton
            label="Show a test ad"
            material="glass"
            size="sm"
            fullWidth
            loading={busy}
            onPress={run}
          />
          {result ? (
            <PidroText role="metadata" selectable accessibilityLiveRegion="polite">
              {result}
            </PidroText>
          ) : null}
        </>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  row: { padding: PidroSpacing.sm, gap: PidroSpacing.xs },
  // One line, so About the app still fits a 375pt-tall landscape phone.
  line: {
    padding: PidroSpacing.sm,
    gap: PidroSpacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
