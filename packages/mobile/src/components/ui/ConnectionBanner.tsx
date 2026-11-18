import { StyleSheet, View } from 'react-native';
import { useTranslation } from '@/i18n';
import { PidroBevel, PidroColors, PidroRadii, PidroSpacing } from '@/design/tokens';
import { PidroText } from './PidroText';

interface ConnectionBannerProps {
  isConnected: boolean;
}

export function ConnectionBanner({ isConnected }: ConnectionBannerProps) {
  const { t } = useTranslation();
  if (isConnected) return null;

  return (
    // Solid, on the navy panel: at the table it floats over your seat, and nothing reads through.
    <View style={styles.solid}>
      <View testID="connection-banner" style={styles.banner} accessibilityRole="alert">
        <View style={styles.dot} />
        <PidroText role="metadata" tone="default">
          {t('ui.reconnecting')}
        </PidroText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  solid: {
    borderRadius: PidroRadii.full,
    backgroundColor: PidroBevel.panelDeep,
  },
  banner: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.xs,
    borderRadius: PidroRadii.full,
    borderWidth: 1,
    borderColor: 'rgba(255, 217, 138, 0.46)',
    backgroundColor: PidroColors.warningBg,
    paddingHorizontal: PidroSpacing.sm,
    paddingVertical: PidroSpacing.xxs,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroColors.warning,
  },
});
