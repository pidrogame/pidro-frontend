import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { PidroColors, PidroFonts, PidroLayout } from '@/design/tokens';
import { PidroText } from './PidroText';
import { PressableFX } from './PressableFX';

export interface TextLinkProps {
  label: string;
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
      style={[styles.target, disabled && styles.disabled, style]}>
      <PidroText
        style={[styles.label, { fontSize: size, lineHeight: size + 6 }]}
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
