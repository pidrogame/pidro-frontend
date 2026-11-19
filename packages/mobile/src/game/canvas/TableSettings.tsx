import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BevelButton } from '@/components/ui/BevelButton';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PidroSwitch } from '@/components/ui/PidroSwitch';
import { StillLayer } from '@/components/ui/StillLayer';
import { PidroColors, PidroSpacing } from '@/design/tokens';
import { useSettingsStore } from '@/stores/settings';
import { useCountHelp } from '@/hooks/useCountHelp';
import { headerTop } from './TableChrome';
import { TableUtilityWindow } from './TableUtilityWindow';
import { useTranslation } from '@/i18n';
import { GameProblemReport } from './GameProblemReport';
import { LeaveQuestion } from './LeaveQuestion';

export function TableSettings({
  onLeave,
  isSpectator = false,
  isSolo = false,
  isGameOver = false,
  onRules,
  initiallyOpen = false,
}: {
  onLeave: () => void;
  isSpectator?: boolean;
  isSolo?: boolean;
  isGameOver?: boolean;
  onRules?: () => void;
  initiallyOpen?: boolean;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const [reportOpen, setReportOpen] = useState(false);
  const [panel, setPanel] = useState<'settings' | 'leave' | null>(
    initiallyOpen ? 'settings' : null
  );
  const soundEnabled = useSettingsStore((state) => state.soundEnabled);
  const toggleSound = useSettingsStore((state) => state.toggleSound);
  const hapticEnabled = useSettingsStore((state) => state.hapticEnabled);
  const toggleHaptic = useSettingsStore((state) => state.toggleHaptic);
  const countHelp = useCountHelp();
  const setCountHelp = useSettingsStore((state) => state.setCountHelp);
  const pace = useSettingsStore((state) => state.pace);
  const setPace = useSettingsStore((state) => state.setPace);
  const close = () => setPanel(null);
  const leave = () => {
    close();
    onLeave();
  };
  return (
    <>
      <View
        style={[
          styles.trigger,
          { top: headerTop(insets.top), right: insets.right + PidroSpacing.sm },
        ]}>
        <StillLayer bleed={16}>
          <BevelButton
            material="glass"
            size="icon"
            accessibilityLabel={t('game.settings')}
            onPress={() => setPanel('settings')}>
            <Icon name="settings" size={22} />
          </BevelButton>
        </StillLayer>
      </View>
      <TableUtilityWindow
        title={t(panel === 'leave' ? 'game.leave_question' : 'game.settings')}
        open={panel !== null}
        wide={landscape && panel === 'settings'}
        onClose={close}>
        {panel === 'leave' ? (
          <LeaveQuestion onStay={close} onLeave={leave} />
        ) : (
          <View style={[styles.columns, landscape && styles.landscape]}>
            <View style={[styles.column, landscape && styles.half]}>
              {onRules && !landscape && (
                <BevelButton
                  material="glass"
                  label={t('rules.menu')}
                  testID="table-rules-menu"
                  onPress={() => {
                    close();
                    onRules();
                  }}
                />
              )}
              <View style={styles.row} testID="settings-counting">
                <View style={styles.copy}>
                  <PidroText role="label">{t('settings.countForMe')}</PidroText>
                  <PidroText role="metadata" tone="muted">
                    {t('settings.countForMeHint')}
                  </PidroText>
                </View>
                <PidroSwitch
                  accessibilityLabel={t('settings.countForMe')}
                  value={countHelp}
                  onValueChange={setCountHelp}
                />
              </View>
              {/* With people at the table it plays quick, whatever the player chose. */}
              <View style={styles.row} testID="settings-pace">
                <View style={styles.copy}>
                  <PidroText role="label">{t('settings.waitForMe')}</PidroText>
                  <PidroText role="metadata" tone="muted">
                    {t(isSolo ? 'settings.waitForMeHint' : 'settings.paceTableQuick')}
                  </PidroText>
                </View>
                <PidroSwitch
                  accessibilityLabel={t('settings.waitForMe')}
                  value={pace === 'own'}
                  disabled={!isSolo}
                  onValueChange={(on) => setPace(on ? 'own' : 'quick')}
                />
              </View>
            </View>
            <View style={[styles.column, landscape && styles.half]}>
              {onRules && landscape && (
                <BevelButton
                  material="glass"
                  label={t('rules.menu')}
                  testID="table-rules-menu"
                  onPress={() => {
                    close();
                    onRules();
                  }}
                />
              )}
              <View style={styles.row}>
                <PidroText role="label" style={styles.copy}>
                  {t('settings.sound')}
                </PidroText>
                <PidroSwitch
                  accessibilityLabel={t('settings.sound')}
                  value={soundEnabled}
                  onValueChange={toggleSound}
                />
              </View>
              <View style={styles.row}>
                <PidroText role="label" style={styles.copy}>
                  {t('settings.haptics')}
                </PidroText>
                <PidroSwitch
                  accessibilityLabel={t('settings.haptics')}
                  value={hapticEnabled}
                  onValueChange={toggleHaptic}
                />
              </View>
              <View style={styles.exit}>
                {!isSpectator && (
                  <View style={styles.exitAction}>
                    <BevelButton
                      material="glass"
                      size="sm"
                      fullWidth
                      accessibilityLabel={t('game.report_title')}
                      label={t('game.report_action')}
                      onPress={() => {
                        close();
                        setReportOpen(true);
                      }}
                    />
                  </View>
                )}
                <View style={styles.exitAction}>
                  <BevelButton
                    material="glass"
                    tone={isSpectator ? 'default' : 'danger'}
                    size="sm"
                    fullWidth
                    accessibilityLabel={t(isSpectator ? 'game.lobby' : 'game.leave')}
                    label={t(isSpectator ? 'game.lobby' : 'game.leave')}
                    onPress={isSpectator || isGameOver ? leave : () => setPanel('leave')}
                  />
                </View>
              </View>
            </View>
          </View>
        )}
      </TableUtilityWindow>
      {!isSpectator && <GameProblemReport open={reportOpen} onClose={() => setReportOpen(false)} />}
    </>
  );
}

const styles = StyleSheet.create({
  columns: { gap: PidroSpacing.sm },
  landscape: { flexDirection: 'row', gap: PidroSpacing.lg },
  column: { gap: PidroSpacing.sm },
  half: { flex: 1 },
  trigger: { position: 'absolute', zIndex: 44, elevation: 44 },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.sm,
  },
  copy: { flex: 1, gap: PidroSpacing.xxs },
  exitAction: { flex: 1, minWidth: 0 },
  exit: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: PidroColors.border,
    paddingTop: PidroSpacing.sm,
    gap: PidroSpacing.sm,
  },
});
