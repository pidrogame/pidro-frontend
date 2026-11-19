import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useCallback, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import type { RuleSet } from '@pidro/shared';
import { RuleSetChip, RuleSetSelector } from '@/components/rules/RuleSet';
import { RulesExplainer } from '@/components/rules/RulesExplainer';
import { ruleSetFixture } from '@/features/rules/fixtures';
import { useTranslation } from '@/i18n';
import { LanguageSelector } from './LanguageSelector';
import { PidroText } from '@/components/ui/PidroText';
import { PidroSwitch } from '@/components/ui/PidroSwitch';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenShell } from '@/components/ui/ScreenShell';
import { Surface } from '@/components/ui/Surface';
import { Modal } from '@/components/ui/Modal';
import { BevelButton } from '@/components/ui/BevelButton';
import { TextLink } from '@/components/ui/TextLink';
import { Toast } from '@/components/ui/Toast';
import { useLeague } from '@/components/league/LeagueHost';
import { AccountSection } from '@/components/settings/AccountSection';
import { AppUpdateSection } from '@/components/settings/AppUpdateSection';
import { PremiumSection, RestorePurchasesLink } from '@/components/settings/PremiumSection';
import { PrivacyChoicesRow } from '@/components/settings/PrivacyChoicesRow';
import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import { TellRow } from '@/components/feedback/TellRow';
import { PidroSpacing } from '@/design/tokens';
import { canTell, tellFixture } from '@/features/feedback';
import { useCountHelp } from '@/hooks/useCountHelp';
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
  const countHelp = useCountHelp();
  const setCountHelp = useSettingsStore((state) => state.setCountHelp);
  const pace = useSettingsStore((state) => state.pace);
  const setPace = useSettingsStore((state) => state.setPace);
  const signedIn = useAuthStore((state) => Boolean(state.user));
  const registered = useAuthStore((state) => Boolean(state.user && !state.user.guest));
  const { data: league, busy: leagueBusy, setHidden } = useLeague();
  const [hideConfirm, setHideConfirm] = useState(false);
  const [leagueFailed, setLeagueFailed] = useState(false);
  const tells = useAuthStore((state) => canTell(state.user));
  const preferredRuleSet = useSettingsStore((state) => state.preferredRuleSet);
  const setPreferredRuleSet = useSettingsStore((state) => state.setPreferredRuleSet);
  const setLobbyRuleSetFilter = useSettingsStore((state) => state.setLobbyRuleSetFilter);
  const { fixture } = useLocalSearchParams<{ fixture?: string }>();
  const initialFixture = ruleSetFixture(fixture);
  const [fixtureChoice, setFixtureChoice] = useState<RuleSet | undefined>();
  const ruleSet = initialFixture ? (fixtureChoice ?? initialFixture) : preferredRuleSet;
  const [rulesOpen, setRulesOpen] = useState(false);
  const tell = __DEV__ ? tellFixture(fixture) : null;
  const [tellOpen, setTellOpen] = useState(Boolean(tell?.sheet));
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const changeHidden = (hidden: boolean) => {
    setLeagueFailed(false);
    void setHidden(hidden)
      .then(() => setHideConfirm(false))
      .catch(() => setLeagueFailed(true));
  };

  return (
    <View style={styles.root}>
      <ScreenShell
        scroll
        compact={width <= height}
        testID="settings-screen"
        contentStyle={{
          ...styles.shell,
          paddingBottom: bottomClearance + PidroSpacing.md,
          paddingRight: rightClearance + PidroSpacing.md,
        }}>
        <ScreenHeader title={t('settings.title')} onBack={onBack} />
        <Surface variant="window" style={styles.panel} padded>
          {tells ? <TellRow testID="settings-tell" onPress={() => setTellOpen(true)} /> : null}
          <Surface variant="subtle" style={styles.rulesRow} testID="settings-preferred-rules">
            <PidroText role="label">{t('rules.preferred')}</PidroText>
            <RuleSetSelector
              value={ruleSet}
              onChange={
                initialFixture
                  ? setFixtureChoice
                  : (choice) => {
                      if (choice === preferredRuleSet) return;
                      // Tables starts from the new choice too (PID-479).
                      setPreferredRuleSet(choice);
                      setLobbyRuleSetFilter(choice);
                    }
              }
            />
            <View style={styles.rulesLine}>
              <RuleSetChip
                ruleSet={ruleSet}
                flagOnly
                testID="settings-rules-flag"
                onPress={() => setRulesOpen(true)}
                style={styles.flagRoomy}
              />
              <PidroText role="metadata" tone="muted" style={styles.grow}>
                {t(`rules.description.${ruleSet}`)}
              </PidroText>
            </View>
          </Surface>
          <RulesExplainer
            ruleSet={ruleSet}
            tableCode=""
            open={rulesOpen}
            onClose={() => setRulesOpen(false)}
          />
          <SettingRow
            testID="settings-counting"
            title={t('settings.countForMe')}
            hint={t('settings.countForMeHint')}
            value={countHelp}
            onValueChange={setCountHelp}
          />
          <SettingRow
            testID="settings-pace"
            title={t('settings.waitForMe')}
            hint={t('settings.waitForMeHint')}
            value={pace === 'own'}
            onValueChange={(on) => setPace(on ? 'own' : 'quick')}
          />
          <LanguageSelector />
          <SettingRow
            title={t('settings.sound')}
            value={soundEnabled}
            onValueChange={toggleSound}
          />
          <SettingRow
            title={t('settings.haptics')}
            value={hapticEnabled}
            onValueChange={toggleHaptic}
          />
          {registered && league && league.status !== 'guest' && league.status !== 'off' ? (
            <>
              <SettingRow
                testID="settings-league"
                title={t('league.settings.hidden')}
                hint={t('league.settings.help')}
                value={league.status === 'opted_out'}
                disabled={leagueBusy}
                onValueChange={(hidden) => {
                  setLeagueFailed(false);
                  if (hidden && league.status === 'placed') setHideConfirm(true);
                  else changeHidden(hidden);
                }}
              />
              {leagueFailed && !hideConfirm ? (
                <PidroText role="metadata" tone="danger" accessibilityRole="alert">
                  {t('league.settings.error')}
                </PidroText>
              ) : null}
            </>
          ) : null}
        </Surface>
        {signedIn ? <AccountSection /> : null}
        <PremiumSection fixture={fixture} onToast={setToast} />
        <PrivacyChoicesRow fixture={__DEV__ && fixture === 'privacy-choices'} />
        <AppUpdateSection />
        <RestorePurchasesLink fixture={fixture} onToast={setToast} />
        <Modal
          isOpen={hideConfirm}
          onClose={() => !leagueBusy && setHideConfirm(false)}
          title={t('league.settings.hidden')}
          description={t('league.settings.midweek')}
          supportedOrientations={['portrait', 'landscape']}>
          <View testID="league-hide-confirm">
            {leagueFailed ? (
              <PidroText role="metadata" tone="danger" accessibilityRole="alert">
                {t('league.settings.error')}
              </PidroText>
            ) : null}
            <BevelButton
              label={t('league.settings.hidden')}
              fullWidth
              loading={leagueBusy}
              onPress={() => changeHidden(true)}
            />
            <TextLink
              label={t('common.cancel')}
              disabled={leagueBusy}
              onPress={() => setHideConfirm(false)}
            />
          </View>
        </Modal>
        {tells ? (
          <FeedbackSheet open={tellOpen} fixture={tell?.sheet} onClose={() => setTellOpen(false)} />
        ) : null}
      </ScreenShell>
      {toast ? <Toast key={toast} message={toast} onDismiss={dismissToast} /> : null}
    </View>
  );
}

function SettingRow({
  title,
  hint,
  value,
  disabled,
  testID,
  onValueChange,
}: {
  title: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  testID?: string;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <Surface variant="subtle" style={styles.row} testID={testID}>
      <View style={styles.rowCopy}>
        <PidroText role="label">{title}</PidroText>
        {hint ? (
          <PidroText role="metadata" tone="muted">
            {hint}
          </PidroText>
        ) : null}
      </View>
      <PidroSwitch
        accessibilityLabel={title}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
      />
    </Surface>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  shell: { gap: PidroSpacing.md },
  panel: { gap: PidroSpacing.sm },
  rulesRow: { gap: PidroSpacing.xs, padding: PidroSpacing.sm },
  rulesLine: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.xxs },
  grow: { flex: 1 },
  // Under the selector the flag takes its full 44pt, so its target never covers it.
  flagRoomy: { marginHorizontal: 0, marginVertical: 0 },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.md,
    padding: PidroSpacing.sm,
  },
  rowCopy: { minWidth: 0, flex: 1, gap: PidroSpacing.xxs },
});
