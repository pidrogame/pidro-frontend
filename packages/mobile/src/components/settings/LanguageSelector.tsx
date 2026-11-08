import { useRef, useState, type KeyboardEvent } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { type LanguagePreference } from '@pidro/shared';
import { useLanguagePreference, useTranslation } from '@/i18n';
import { PidroColors, PidroRadii, PidroSpacing } from '@/design/tokens';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { Surface } from '@/components/ui/Surface';

const choices = ['en', 'sv'] as const;
const autonyms = { en: 'English', sv: 'Svenska' } as const;

/** Immediate device preference, independent of the table's rules. */
export function LanguageSelector() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguagePreference();
  const [focused, setFocused] = useState<LanguagePreference | null>(null);
  const refs = useRef<Partial<Record<LanguagePreference, View | null>>>({});

  return (
    <Surface variant="subtle" style={styles.group} testID="settings-language">
      <PidroText role="label">{t('settings.language')}</PidroText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('settings.language')}
        style={styles.choices}>
        {choices.map((choice, index) => {
          const selected = language === choice;
          return (
            <PressableFX
              key={choice}
              ref={(ref) => {
                refs.current[choice] = ref;
              }}
              accessibilityRole="radio"
              accessibilityLabel={autonyms[choice]}
              accessibilityLanguage={choice}
              accessibilityState={{ checked: selected, selected }}
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onFocus={() => setFocused(choice)}
              onBlur={() => setFocused(null)}
              onPress={() => setLanguage(choice)}
              {...(Platform.OS === 'web'
                ? {
                    lang: choice,
                    onKeyDown: (event: KeyboardEvent) => {
                      const delta =
                        event.key === 'ArrowRight' || event.key === 'ArrowDown'
                          ? 1
                          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                            ? -1
                            : 0;
                      if (!delta && event.key !== ' ') return;
                      event.preventDefault();
                      const next = choices[(index + delta + choices.length) % choices.length];
                      setLanguage(next);
                      // RN Web forwards the host ref to its focusable DOM node.
                      (refs.current[next] as unknown as { focus?: () => void })?.focus?.();
                    },
                  }
                : {})}
              style={[
                styles.choice,
                selected && styles.selected,
                focused === choice && styles.focused,
              ]}>
              <View style={[styles.radio, selected && styles.selectedRadio]}>
                {selected ? <View style={styles.dot} /> : null}
              </View>
              <PidroText role="label" style={styles.label}>
                {autonyms[choice]}
              </PidroText>
            </PressableFX>
          );
        })}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  group: { gap: PidroSpacing.xs, padding: PidroSpacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: PidroSpacing.xs },
  choice: {
    minHeight: 48,
    flexGrow: 1,
    flexBasis: 120,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.xs,
    paddingHorizontal: PidroSpacing.sm,
    paddingVertical: PidroSpacing.xs,
    borderRadius: PidroRadii.surface,
    borderWidth: 1,
    borderColor: PidroColors.borderStrong,
    backgroundColor: PidroColors.glass,
  },
  selected: { borderColor: PidroColors.cyanBorderStrong, backgroundColor: PidroColors.glassHover },
  focused: { outlineWidth: 2, outlineColor: PidroColors.cyanText, outlineOffset: 2 },
  label: { flexShrink: 1 },
  radio: {
    width: 16,
    height: 16,
    borderRadius: PidroRadii.full,
    borderWidth: 1,
    borderColor: PidroColors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedRadio: { borderColor: PidroColors.cyanText },
  dot: {
    width: 8,
    height: 8,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroColors.cyanText,
  },
});
