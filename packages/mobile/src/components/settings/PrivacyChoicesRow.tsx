import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { PidroSpacing } from '@/design/tokens';
import { adsPrivacyOptionsRequired, showAdsPrivacyOptions } from '@/features/ads/ads';
import { useTranslation } from '@/i18n';

/** Settings → Privacy: Google's way back into the ad consent choices, only where it is required. */
export function PrivacyChoicesRow({ fixture = false }: { fixture?: boolean }) {
  const { t } = useTranslation();
  const [required, setRequired] = useState(fixture);

  useEffect(() => {
    let active = true;
    void adsPrivacyOptionsRequired().then((value) => {
      if (active && value) setRequired(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!required) return null;
  return (
    <Surface variant="window" padded style={styles.panel} testID="settings-privacy-choices">
      <PidroText role="label">{t('settings.privacy')}</PidroText>
      <PidroText role="metadata" tone="muted">
        {t('update.privacyHint')}
      </PidroText>
      <BevelButton
        label={t('update.privacy')}
        material="glass"
        size="sm"
        fullWidth
        onPress={() => void showAdsPrivacyOptions()}
      />
    </Surface>
  );
}

const styles = StyleSheet.create({ panel: { gap: PidroSpacing.sm } });
