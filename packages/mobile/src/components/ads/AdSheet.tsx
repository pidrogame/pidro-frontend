import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BevelButton } from '@/components/ui/BevelButton';
import { Modal } from '@/components/ui/Modal';
import { PidroText } from '@/components/ui/PidroText';
import { TextLink } from '@/components/ui/TextLink';
import { PidroSpacing } from '@/design/tokens';
import type { AdSheetPhase } from '@/features/ads/useAdOffer';
import { useTranslation } from '@/i18n';

/** A short ad, then we deal: one calm choice before a solo game. No countdown, nothing left to count. */
export function AdSheet({
  phase,
  ready,
  dealing,
  onWatch,
  onClose,
}: {
  phase: AdSheetPhase | null;
  ready: boolean;
  dealing: boolean;
  onWatch: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  // Settings opens once the Modal is gone, or it would open hidden behind it on iOS.
  const premium = useRef(false);
  const openPremium = () => {
    if (!premium.current) return;
    premium.current = false;
    // PID-124's Premium panel lives in Settings.
    router.push('/settings');
  };
  useEffect(() => {
    if (!phase && Platform.OS !== 'ios') openPremium();
  });

  return (
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
  );
}

const styles = StyleSheet.create({
  body: { gap: PidroSpacing.sm, alignItems: 'stretch' },
  close: { alignSelf: 'center' },
});
