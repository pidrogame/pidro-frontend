import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import type { RuleSet } from '@pidro/shared';
import { RuleSetSelector } from '@/components/rules/RuleSet';
import { ruleSetFixture } from '@/features/rules/fixtures';
import { useTranslation } from '@/i18n';
import { LanguageSelector } from './LanguageSelector';
import { PidroText } from '@/components/ui/PidroText';
import { PidroSwitch } from '@/components/ui/PidroSwitch';
import { ActionPill } from '@/components/ui/ActionPill';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { Surface } from '@/components/ui/Surface';
import { AccountSection } from '@/components/settings/AccountSection';
import { AppUpdateSection } from '@/components/settings/AppUpdateSection';
import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import { TellRow } from '@/components/feedback/TellRow';
import { PidroSpacing } from '@/design/tokens';
import { tellFixture } from '@/features/feedback';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';

export function SettingsScreen({
  onBack,
  bottomClearance = 0,
  rightClearance = 0,
}: {
  onBack: () => void;
  bottomClearance?: number;
  rightClearance?: number;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const soundEnabled = useSettingsStore((state) => state.soundEnabled);
  const hapticEnabled = useSettingsStore((state) => state.hapticEnabled);
  const toggleSound = useSettingsStore((state) => state.toggleSound);
  const toggleHaptic = useSettingsStore((state) => state.toggleHaptic);
  const countHelp = useSettingsStore((state) => state.countHelp);
  const toggleCountHelp = useSettingsStore((state) => state.toggleCountHelp);
  const showBid = useSettingsStore((state) => state.showBid);
  const toggleShowBid = useSettingsStore((state) => state.toggleShowBid);
  const pace = useSettingsStore((state) => state.pace);
  const setPace = useSettingsStore((state) => state.setPace);
  const signedIn = useAuthStore((state) => Boolean(state.user));
  const preferredRuleSet = useSettingsStore((state) => state.preferredRuleSet);
  const setPreferredRuleSet = useSettingsStore((state) => state.setPreferredRuleSet);
  const { fixture } = useLocalSearchParams<{ fixture?: string }>();
  const initialFixture = ruleSetFixture(fixture);
  const [fixtureChoice, setFixtureChoice] = useState<RuleSet | undefined>();
  const tell = __DEV__ ? tellFixture(fixture) : null;
  const [tellOpen, setTellOpen] = useState(Boolean(tell?.sheet));

  return (
    <ScreenShell
      scroll
      compact={width <= height}
      testID="settings-screen"
      contentStyle={{
        ...styles.shell,
        paddingBottom: bottomClearance + PidroSpacing.md,
        paddingRight: rightClearance + PidroSpacing.md,
      }}>
      <ScreenHeader title={t('settings.title')} subtitle={t('settings.subtitle')} onBack={onBack} />
      <Surface variant="window" style={styles.panel} padded>
        <TellRow testID="settings-tell" onPress={() => setTellOpen(true)} />
        <View style={styles.languageColumn}>
          <LanguageSelector />
        </View>
        <View style={styles.preferencesColumn}>
          <Surface variant="subtle" style={styles.rulesRow} testID="settings-preferred-rules">
            <PidroText role="label">{t('rules.preferred')}</PidroText>
            <RuleSetSelector
              value={initialFixture ? (fixtureChoice ?? initialFixture) : preferredRuleSet}
              onChange={initialFixture ? setFixtureChoice : setPreferredRuleSet}
            />
          </Surface>
          <SettingRow
            title={t('settings.sound')}
            subtitle={t('settings.soundHint')}
            value={soundEnabled}
            onValueChange={toggleSound}
          />
          <SettingRow
            title={t('settings.haptics')}
            subtitle={t('settings.hapticsHint')}
            value={hapticEnabled}
            onValueChange={toggleHaptic}
          />
          <SettingRow
            title={t('settings.countHelp')}
            subtitle={t('settings.countHelpHint')}
            value={countHelp}
            onValueChange={toggleCountHelp}
          />
          <SettingRow
            title={t('settings.showBid')}
            subtitle={t('settings.showBidHint')}
            value={showBid}
            onValueChange={toggleShowBid}
          />
          <Surface variant="subtle" style={styles.rulesRow} testID="settings-pace">
            <PidroText role="label">{t('settings.pace')}</PidroText>
            <View style={styles.choices}>
              {(['quick', 'own'] as const).map((value) => (
                <ActionPill
                  key={value}
                  size="lg"
                  label={t(value === 'quick' ? 'settings.paceQuick' : 'settings.paceOwn')}
                  selected={pace === value}
                  onPress={() => setPace(value)}
                />
              ))}
            </View>
            <PidroText role="metadata" tone="muted">
              {t('settings.paceHint')} {t('settings.paceSolo')}
            </PidroText>
          </Surface>
        </View>
      </Surface>
      {signedIn ? <AccountSection /> : null}
      <AppUpdateSection />
      <FeedbackSheet open={tellOpen} fixture={tell?.sheet} onClose={() => setTellOpen(false)} />
    </ScreenShell>
  );
}

function SettingRow({
  title,
  subtitle,
  value,
  onValueChange,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: () => void;
}) {
  return (
    <Surface variant="subtle" style={styles.row}>
      <View style={styles.rowCopy}>
        <PidroText role="label">{title}</PidroText>
        <PidroText role="metadata" tone="muted">
          {subtitle}
        </PidroText>
      </View>
      <PidroSwitch accessibilityLabel={title} value={value} onValueChange={onValueChange} />
    </Surface>
  );
}

const styles = StyleSheet.create({
  shell: { gap: PidroSpacing.md },
  panel: { gap: PidroSpacing.sm, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  languageColumn: { flexGrow: 1, flexBasis: 280, minWidth: 0 },
  preferencesColumn: { flexGrow: 1, flexBasis: 280, minWidth: 0, gap: PidroSpacing.sm },
  rulesRow: { gap: PidroSpacing.xs, padding: PidroSpacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: PidroSpacing.xs },
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.md,
    padding: PidroSpacing.sm,
  },
  rowCopy: { minWidth: 0, flex: 1, gap: PidroSpacing.xxs },
});
