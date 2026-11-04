import { StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { PidroBevel, PidroColors, PidroNote, PidroRadii, PidroSpacing } from '@/design/tokens';
import { useTranslation } from '@/i18n';

/** The way into Tell us, in Settings and first in News: the gold pencil, the words, a chevron. */
export function TellRow({ onPress, testID }: { onPress: () => void; testID: string }) {
  const { t } = useTranslation();
  return (
    <PressableFX
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${t('tell.door')}. ${t('tell.rowHint')}`}
      onPress={onPress}
      style={styles.row}
      pressedStyle={styles.pressed}>
      <View style={styles.disc}>
        <Icon name="edit" size={22} strokeWidth={2.2} color={PidroBevel.textGold} />
      </View>
      <View style={styles.copy}>
        <PidroText role="label" style={styles.title}>
          {t('tell.door')}
        </PidroText>
        <PidroText role="metadata" tone="soft" style={styles.hint}>
          {t('tell.rowHint')}
        </PidroText>
      </View>
      <Icon name="chevron-right" size={20} strokeWidth={2.6} color={PidroColors.cyanText} />
    </PressableFX>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.sm,
    paddingVertical: 10,
    paddingHorizontal: PidroSpacing.sm,
    borderRadius: PidroRadii.panel,
    borderWidth: 1,
    borderColor: PidroNote.rowBorder,
    backgroundColor: PidroColors.panelSoft,
  },
  pressed: { backgroundColor: PidroColors.actionPillPressed },
  disc: {
    width: 44,
    height: 44,
    borderRadius: PidroRadii.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PidroNote.rowBorder,
    backgroundColor: PidroNote.disc,
  },
  copy: { minWidth: 0, flex: 1, gap: PidroSpacing.xxs },
  title: { fontSize: 18, lineHeight: 23 },
  hint: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
});
