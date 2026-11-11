import { useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { PremiumSheet } from '@/components/premium/PremiumSheet';
import { BevelButton } from '@/components/ui/BevelButton';
import { Modal } from '@/components/ui/Modal';
import { PidroText } from '@/components/ui/PidroText';
import { TextLink } from '@/components/ui/TextLink';
import { PidroSpacing } from '@/design/tokens';
import type { AdSheetPhase } from '@/features/ads/useAdOffer';
import { canBuyPremium } from '@/features/premium/premiumSheet';
import { purchasesAvailable } from '@/features/premium/purchases';
import { useTranslation } from '@/i18n';
import { authStore } from '@/stores/auth';

/** A short ad, then we deal: one calm choice before a solo game. No countdown, nothing left to count. */
export function AdSheet({
  phase,
  ready,
  dealing,
  onWatch,
  onClose,
  onDeal,
}: {
  phase: AdSheetPhase | null;
  ready: boolean;
  dealing: boolean;
  onWatch: () => void;
  onClose: () => void;
  onDeal: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [premiumOpen, setPremiumOpen] = useState(false);
  // Premium opens once the Modal is gone, or it would open hidden behind it on iOS.
  const premium = useRef(false);
  const openPremium = () => {
    if (!premium.current) return;
    premium.current = false;
    // The Premium sheet where this build can sell it (PID-126); elsewhere Settings, as before.
    if (canBuyPremium(authStore.getState().user, purchasesAvailable())) setPremiumOpen(true);
    else router.push('/settings');
  };
  return (
    <>
      <Modal
        isOpen={phase !== null}
        onClose={onClose}
        dismissible={!dealing}
        onDismiss={openPremium}
        title={t('ads.title')}>
        <View testID="ad-sheet" style={styles.body}>
          {phase === 'dismissed' || phase === 'unavailable' ? (
            <PidroText role="body" tone="soft" align="center" accessibilityLiveRegion="polite">
              {t(phase === 'unavailable' ? 'ads.unavailable' : 'ads.dismissed')}
            </PidroText>
          ) : null}
          <BevelButton
            testID="ad-watch"
            label={t('ads.watch')}
            material="wood"
            fullWidth
            loading={dealing || !ready}
            onPress={onWatch}
          />
          <BevelButton
            testID="ad-premium"
            label={t('ads.premium')}
            material="glass"
            fullWidth
            disabled={dealing}
            onPress={() => {
              premium.current = true;
              onClose();
              // Elsewhere nothing waits for the Modal to leave.
              if (Platform.OS !== 'ios') openPremium();
            }}
          />
          <PidroText role="metadata" tone="muted" align="center">
            {t('ads.online_free')}
          </PidroText>
          <TextLink
            testID="ad-close"
            label={t('ads.not_now')}
            accessibilityRole="button"
            disabled={dealing}
            onPress={onClose}
            style={styles.close}
          />
        </View>
      </Modal>
      <PremiumSheet
        open={premiumOpen}
        door="ad"
        onClose={() => setPremiumOpen(false)}
        onDeal={onDeal}
      />
    </>
  );
}

const styles = StyleSheet.create({
  body: { gap: PidroSpacing.sm, alignItems: 'stretch' },
  close: { alignSelf: 'center' },
});
