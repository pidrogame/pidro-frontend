import { useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { PremiumSheet } from '@/components/premium/PremiumSheet';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { PidroSpacing } from '@/design/tokens';
import {
  premiumDate,
  premiumFixture,
  premiumInSettings,
  premiumStatus,
  restorePremium,
} from '@/features/premium/premium';
import { canBuyPremium, premiumSheetFixture } from '@/features/premium/premiumSheet';
import { purchasesAvailable } from '@/features/premium/purchases';
import { getLocale, useTranslation } from '@/i18n';
import { useAuthStore } from '@/stores/auth';

const STORE = Platform.OS === 'android' ? 'Google' : 'App Store';
const SUBSCRIPTIONS =
  Platform.OS === 'android'
    ? 'https://play.google.com/store/account/subscriptions'
    : 'https://apps.apple.com/account/subscriptions';

type Props = { fixture?: string; onToast: (message: string) => void };

/** The server's answer and the Restore purchases it ends in; a fixture never reaches the store. */
function usePremium({ fixture, onToast }: Props) {
  const { t } = useTranslation();
  const sheet = premiumSheetFixture(fixture);
  // The sheet's fixtures open over Settings as a player without Premium sees it.
  const preview = premiumFixture(sheet ? 'premium-none' : fixture);
  const user = useAuthStore((state) => state.user);
  const fields = preview?.fields ?? user;
  const [busy, setBusy] = useState(preview?.restoring ?? false);
  const inFlight = useRef(false);

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

  const storeAvailable = Boolean(preview) || purchasesAvailable();
  return {
    shows: premiumInSettings(fields),
    status: premiumStatus(fields),
    preview,
    sheet,
    canBuy: canBuyPremium(fields, storeAvailable),
    storeAvailable,
    busy,
    restore,
  };
}

/**
 * For a player with Premium: until when, Restore purchases and the store's subscription page.
 * For one without, where this build can sell it: the way into the Premium sheet (PID-126).
 */
export function PremiumSection(props: Props) {
  const { t } = useTranslation();
  const { shows, status, preview, sheet, canBuy, storeAvailable, busy, restore } =
    usePremium(props);
  const [sheetOpen, setSheetOpen] = useState(Boolean(sheet));
  const { until, source } = status;
  // Held while the sheet is open: a purchase makes the player Premium under it.
  if (canBuy || sheetOpen)
    return (
      <Surface variant="window" padded style={styles.panel} testID="settings-premium-offer">
        <View style={styles.heading}>
          <PidroText role="label">{t('premium.sheet.title')}</PidroText>
          <PidroText role="metadata" tone="muted">
            {t('premium.sheet.rowHint')}
          </PidroText>
        </View>
        <BevelButton
          label={t('premium.sheet.open')}
          material="glass"
          fullWidth
          onPress={() => setSheetOpen(true)}
          testID="premium-open"
        />
        <PremiumSheet
          open={sheetOpen}
          door={sheet?.door ?? 'settings'}
          fixture={sheet}
          onClose={() => setSheetOpen(false)}
        />
      </Surface>
    );
  if (shows !== 'panel') return null;

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

  const date = until ? premiumDate(until, getLocale()) : null;

  return (
    <Surface variant="window" padded style={styles.panel} testID="settings-premium">
      <View style={styles.heading}>
        <PidroText role="label">{t('premium.title')}</PidroText>
        <PidroText role="body" testID="premium-status">
          {date ? t('premium.until', { date }) : t('premium.lifetime')}
        </PidroText>
      </View>
      {storeAvailable ? (
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
      {storeAvailable ? (
        <PidroText role="metadata" tone="muted">
          {t('premium.explain', { store: STORE })}
        </PidroText>
      ) : null}
    </Surface>
  );
}

/** Without Premium, Restore purchases is a quiet link at the bottom: stores require a way back. */
export function RestorePurchasesLink(props: Props) {
  const { t } = useTranslation();
  const { shows, storeAvailable, busy, restore } = usePremium(props);
  if (shows !== 'restore' || !storeAvailable) return null;
  return (
    <TextLink
      label={t('premium.restore')}
      accessibilityRole="button"
      disabled={busy}
      onPress={restore}
      testID="settings-restore"
    />
  );
}

const styles = StyleSheet.create({
  panel: { gap: PidroSpacing.sm },
  heading: { gap: PidroSpacing.xxs },
});
