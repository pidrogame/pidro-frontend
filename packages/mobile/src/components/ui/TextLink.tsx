import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { PidroColors, PidroFonts, PidroLayout } from '@/design/tokens';
import { Icon, type IconName } from './Icon';
import { PidroText } from './PidroText';
import { PressableFX } from './PressableFX';

export interface TextLinkProps {
  label: string;
  /** A glyph before the label, in the label's cyan. */
  icon?: IconName;
  onPress: () => void;
  /** 14 inside a form, 15 under a window, 16 on tablets. */
  size?: 14 | 15 | 16;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: 'link' | 'button';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A quiet cyan text action: the secondary way out of a screen. The label is
 * small but the target is always a full 44px.
 */
export function TextLink({
  label,
  icon,
  onPress,
  size = 15,
  disabled = false,
  accessibilityLabel,
  accessibilityRole = 'link',
  style,
  testID,
}: TextLinkProps) {
  return (
    <PressableFX
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[styles.target, !!icon && styles.row, disabled && styles.disabled, style]}>
      {icon && <Icon name={icon} size={size + 2} color={PidroColors.cyanText} />}
      <PidroText
        style={[styles.label, !!icon && styles.shrink, { fontSize: size, lineHeight: size + 6 }]}
        maxFontSizeMultiplier={1.4}>
        {label}
      </PidroText>
    </PressableFX>
  );
}

const styles = StyleSheet.create({
  target: {
    minWidth: PidroLayout.touchTarget,
    minHeight: PidroLayout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  // Beside an icon a label that runs out of room wraps instead of pushing past its row.
  shrink: {
    flexShrink: 1,
  },
  label: {
    fontFamily: PidroFonts.ui,
    fontWeight: '800',
    color: PidroColors.cyanText,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});
