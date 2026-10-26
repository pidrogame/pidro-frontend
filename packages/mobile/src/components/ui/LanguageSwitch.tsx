import { useRef, useState, type KeyboardEvent } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { PidroBevel, PidroColors, PidroLayout, PidroRadii, PidroSpacing } from '@/design/tokens';
import { useLanguagePreference, useTranslation, type Locale } from '@/i18n';
import { gradientBg } from './Bevel';
import { PidroText } from './PidroText';
import { PressableFX } from './PressableFX';

const choices = ['en', 'sv'] as const;
const autonyms = { en: 'English', sv: 'Svenska' } as const;

export function LanguageSwitch() {
  const { t, locale } = useTranslation();
  const { setLanguage } = useLanguagePreference();
  const [focused, setFocused] = useState<Locale | null>(null);
  const refs = useRef<Partial<Record<Locale, View | null>>>({});

  return (
    <View
      testID="language-switch"
      accessibilityRole="radiogroup"
      accessibilityLabel={t('settings.language')}
      style={styles.group}>
      {choices.map((choice, index) => (
        <PressableFX
          key={choice}
          ref={(ref) => {
            refs.current[choice] = ref;
          }}
          accessibilityRole="radio"
          accessibilityLabel={autonyms[choice]}
          accessibilityLanguage={choice}
          accessibilityState={{ checked: locale === choice, selected: locale === choice }}
          aria-checked={locale === choice}
          tabIndex={locale === choice ? 0 : -1}
          onFocus={() => setFocused(choice)}
          onBlur={() => setFocused(null)}
          onPress={() => setLanguage(choice)}
          {...(Platform.OS === 'web'
            ? {
                lang: choice,
                onKeyDown: (event: KeyboardEvent) => {
                  const arrow = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(
                    event.key
                  );
                  if (!arrow && event.key !== ' ') return;
                  event.preventDefault();
                  const next = choices[arrow ? 1 - index : index];
                  setLanguage(next);
                  (refs.current[next] as unknown as { focus?: () => void })?.focus?.();
                },
              }
            : {})}
          style={[
            styles.choice,
            locale === choice && styles.selected,
            focused === choice && styles.focused,
          ]}>
          <PidroText role="metadata" style={styles.label}>
            {autonyms[choice]}
          </PidroText>
        </PressableFX>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    borderRadius: PidroRadii.surface,
    borderWidth: 1,
    borderColor: PidroColors.borderStrong,
    backgroundColor: PidroColors.glass,
  },
  choice: {
    minWidth: PidroLayout.touchTarget,
    minHeight: PidroLayout.touchTarget,
    paddingHorizontal: PidroSpacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PidroRadii.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selected: {
    ...gradientBg(PidroBevel.glassFaceGradient),
    borderColor: PidroColors.cyanBorderStrong,
  },
  focused: { outlineWidth: 2, outlineColor: PidroColors.cyanText, outlineOffset: 2 },
  label: { fontWeight: '800' },
});
