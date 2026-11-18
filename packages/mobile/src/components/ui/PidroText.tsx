import {
  Platform,
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle,
  StyleSheet,
} from 'react-native';
import { PidroColors, PidroFonts, PidroType } from '@/design/tokens';
import { nunitoFamily } from '@/features/nunito';
import { useLocale } from '@/i18n';

const ANDROID = Platform.OS === 'android';

/** On Android, Nunito's final weight picks its static family and the weight itself stays normal. */
export function staticNunito(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  if (!ANDROID) return style;
  const flat = StyleSheet.flatten(style);
  return flat?.fontFamily === PidroFonts.ui
    ? { ...flat, fontFamily: nunitoFamily(Platform.OS, flat.fontWeight), fontWeight: 'normal' }
    : flat;
}

export type PidroTextRole =
  'score' | 'display' | 'title' | 'label' | 'body' | 'metadata' | 'eyebrow';
export type PidroTextTone = 'default' | 'soft' | 'muted' | 'gold' | 'cyan' | 'danger';

export interface PidroTextProps extends Omit<TextProps, 'role'> {
  role?: PidroTextRole;
  tone?: PidroTextTone;
  align?: TextStyle['textAlign'];
}

export function PidroText({
  role = 'body',
  tone = 'default',
  align,
  style,
  maxFontSizeMultiplier,
  ...props
}: PidroTextProps) {
  const locale = useLocale();
  return (
    <Text
      accessibilityLanguage={locale}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (role === 'body' ? 1.8 : 1.5)}
      style={staticNunito([
        styles.base,
        styles[role],
        styles[tone],
        align ? { textAlign: align } : null,
        style,
      ])}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    color: PidroColors.text,
  },
  score: PidroType.score,
  display: PidroType.display,
  title: PidroType.title,
  label: PidroType.label,
  body: PidroType.body,
  metadata: PidroType.metadata,
  eyebrow: PidroType.eyebrow,
  default: {
    color: PidroColors.text,
  },
  soft: {
    color: PidroColors.textSoft,
  },
  muted: {
    color: PidroColors.textMuted,
  },
  gold: {
    color: PidroColors.gold,
  },
  cyan: {
    color: PidroColors.cyanText,
  },
  danger: {
    color: PidroColors.dangerText,
  },
});
