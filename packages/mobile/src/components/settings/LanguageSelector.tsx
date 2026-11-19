import { useState, type KeyboardEvent } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { type LanguagePreference } from '@pidro/shared';
import { useLanguagePreference, useTranslation } from '@/i18n';
import { PidroColors, PidroSpacing } from '@/design/tokens';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';

const choices = ['en', 'sv'] as const;
const autonyms = { en: 'English', sv: 'Svenska' } as const;

/** Immediate device preference, independent of the table's rules: wood is chosen, glass is not. */
export function LanguageSelector() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguagePreference();
  const [focused, setFocused] = useState<LanguagePreference | null>(null);

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
            <BevelButton
              key={choice}
              label={autonyms[choice]}
              material={selected ? 'wood' : 'glass'}
              size="sm"
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
                      // The radios are siblings in the group's DOM node on web.
                      const group = (event.currentTarget as unknown as HTMLElement).parentElement;
                      (group?.children[choices.indexOf(next)] as HTMLElement | undefined)?.focus();
                    },
                  }
                : {})}
              style={focused === choice && styles.focused}
            />
          );
        })}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  group: { gap: PidroSpacing.xs, padding: PidroSpacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: PidroSpacing.xxs },
  focused: { outlineWidth: 2, outlineColor: PidroColors.cyanText, outlineOffset: 2 },
});
