import { useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { PidroSpacing } from '@/design/tokens';
import { premiumFixture, premiumStatus, restorePremium } from '@/features/premium/premium';
import { purchasesAvailable } from '@/features/premium/purchases';
import { getLocale, useTranslation } from '@/i18n';
import { useAuthStore } from '@/stores/auth';

const STORE = Platform.OS === 'android' ? 'Google' : 'App Store';
const SUBSCRIPTIONS =
  Platform.OS === 'android'
    ? 'https://play.google.com/store/account/subscriptions'
    : 'https://apps.apple.com/account/subscriptions';

/** What the server says about Premium, Restore purchases and the store's subscription page. */
export function PremiumSection({
  fixture,
  onToast,
}: {
  fixture?: string;
  onToast: (message: string) => void;
}) {
  const { t } = useTranslation();
  const preview = premiumFixture(fixture);
  const user = useAuthStore((state) => state.user);
  const { premium, until, source } = premiumStatus(preview?.fields ?? user);
  const [busy, setBusy] = useState(preview?.restoring ?? false);
  const inFlight = useRef(false);

  // The web app has no store: a fixture previews the phone's panel.
  if (!preview && Platform.OS === 'web')
    return (
      <Surface variant="window" padded style={styles.panel} testID="settings-premium">
        <PidroText role="label">{t('premium.title')}</PidroText>
        <PidroText role="metadata" tone="muted">
          {t('premium.web')}
        </PidroText>
      </Surface>
    );

  async function restore() {
    if (preview || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const outcome = await restorePremium();
    inFlight.current = false;
    setBusy(false);
    onToast(
      outcome === 'restored'
        ? t('premium.restored')
        : outcome === 'notFound'
          ? t('premium.notFound', { store: STORE })
          : t('premium.restoreFailed')
    );
  }

  // "12 March 2027" in English, "12 mars 2027" in Swedish.
  const date = until
    ? new Intl.DateTimeFormat(getLocale() === 'en' ? 'en-GB' : getLocale(), {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(until)
    : null;

  return (
    <Surface variant="window" padded style={styles.panel} testID="settings-premium">
      <View style={styles.heading}>
        <PidroText role="label">{t('premium.title')}</PidroText>
        <PidroText role="body" testID="premium-status">
          {!premium
            ? t('premium.none')
            : date
              ? t('premium.until', { date })
              : t('premium.lifetime')}
        </PidroText>
      </View>
      {preview || purchasesAvailable() ? (
        <BevelButton
          label={t('premium.restore')}
          material="glass"
          fullWidth
          loading={busy}
          onPress={restore}
          testID="premium-restore"
        />
      ) : null}
      {/* A subscription, not a one-off purchase: only a subscription has a date. */}
      {source === 'store' && until ? (
        <BevelButton
          label={t('premium.manage')}
          material="glass"
          fullWidth
          onPress={() => void Linking.openURL(SUBSCRIPTIONS)}
          testID="premium-manage"
        />
      ) : null}
      {preview || purchasesAvailable() ? (
        <PidroText role="metadata" tone="muted">
          {t('premium.explain', { store: STORE })}
        </PidroText>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  panel: { gap: PidroSpacing.sm },
  heading: { gap: PidroSpacing.xxs },
});
