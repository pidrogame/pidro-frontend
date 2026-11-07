import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { PidroSpacing } from '@/design/tokens';
import { adsPrivacyOptionsRequired, showAdsPrivacyOptions } from '@/features/ads/ads';
import { useTranslation } from '@/i18n';

/** Google's way back into the ad consent choices, only where it is required (PID-119). */
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
    <Surface variant="subtle" style={styles.row} testID="settings-privacy-choices">
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

const styles = StyleSheet.create({ row: { padding: PidroSpacing.sm, gap: PidroSpacing.xs } });
