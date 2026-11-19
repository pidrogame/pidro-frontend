import { useState } from 'react';
import { Linking, Modal, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { RuleSet } from '@pidro/shared';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { PidroColors, PidroSpacing } from '@/design/tokens';
import { ruleSets, shouldExplainLouisiana } from '@/features/rules/ruleSets';
import { SUPPORT_EMAIL } from '@/features/auth/classicRecovery';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from '@/i18n';
import { RuleSetFlag, ruleSetLabel } from './RuleSet';

export function useRulesExplainer(ruleSet: RuleSet, spectator: boolean, fixtureSeen?: boolean) {
  const seen = useSettingsStore((state) => state.hasSeenLouisianaRules);
  const markSeen = useSettingsStore((state) => state.markLouisianaRulesSeen);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  return {
    open:
      open ||
      shouldExplainLouisiana(
        ruleSet,
        fixtureSeen === undefined ? seen : fixtureSeen || dismissed,
        spectator
      ),
    show: () => setOpen(true),
    dismiss: () => {
      setOpen(false);
      setDismissed(true);
      if (ruleSet === 'louisiana' && !spectator && fixtureSeen === undefined) markSeen();
    },
  };
}

export function RulesExplainer({
  ruleSet,
  tableCode,
  open,
  onClose,
}: {
  ruleSet: RuleSet;
  tableCode: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mailError, setMailError] = useState(false);
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  // What differs from the other rule set comes first: how you play, who sits out, the lowest bid.
  const facts = (['play', 'turns', 'bid', 'winner'] as const).map((fact) =>
    t(`rules.${fact}.${ruleSet}`)
  );
  return (
    <Modal
      visible={open}
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Surface
              variant="window"
              style={[styles.panel, landscape && styles.widePanel]}
              testID="rules-explainer">
              <View style={styles.header}>
                <RuleSetFlag ruleSet={ruleSet} height={20} />
                <PidroText
                  role="title"
                  accessibilityRole="header"
                  testID="rules-explainer-rule-set">
                  {t(ruleSets[ruleSet].longKey)}
                </PidroText>
              </View>
              <View style={[styles.facts, landscape && styles.row]}>
                {facts.map((fact, index) => (
                  <PidroText
                    key={index}
                    testID={`rules-fact-${index}`}
                    style={landscape && styles.half}>
                    {fact}
                  </PidroText>
                ))}
              </View>
              <View style={[styles.footer, landscape && styles.row]}>
                <TextLink
                  label={t('rules.feedback')}
                  testID="rules-feedback"
                  onPress={async () => {
                    setMailError(false);
                    try {
                      const values = {
                        rules: ruleSetLabel(ruleSet),
                        // Settings and a table not yet opened have no code.
                        code: tableCode || '–',
                        facts: facts.join('\n'),
                      };
                      const subject = encodeURIComponent(
                        t(tableCode ? 'rules.mailSubject' : 'rules.mailSubjectNoTable', values)
                      );
                      const body = encodeURIComponent(t('rules.mailBody', values));
                      await Linking.openURL(
                        `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`
                      );
                    } catch {
                      setMailError(true);
                    }
                  }}
                />
                {mailError && (
                  <PidroText tone="danger" accessibilityLiveRegion="polite">
                    {t('rules.mailError')}
                  </PidroText>
                )}
                <BevelButton label={t('rules.done')} testID="rules-done" onPress={onClose} />
              </View>
            </Surface>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PidroColors.backdrop },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: PidroSpacing.md,
  },
  panel: { width: '100%', maxWidth: 520, padding: PidroSpacing.md, gap: PidroSpacing.md },
  widePanel: { maxWidth: 760 },
  header: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.xs },
  facts: { gap: PidroSpacing.md },
  footer: { gap: PidroSpacing.xs },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  half: { width: '47%' },
});
