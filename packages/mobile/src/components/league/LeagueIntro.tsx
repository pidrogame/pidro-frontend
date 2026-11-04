import { useState } from 'react';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { useIsFocused } from 'expo-router';
import { LeagueCard } from './LeagueCard';
import { useLeague } from './LeagueHost';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { LEAGUES } from '@/features/league';
import { PidroColors, PidroFonts, PidroRadii, PidroSpacing } from '@/design/tokens';
import { useTranslation } from '@/i18n';

export function LeagueIntro() {
  const { data, busy, introSeen } = useLeague();
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const short = height < 740;
  const reduceMotion = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const focused = useIsFocused();
  if (!focused || !data || data.intro_seen || !['placed', 'not_placed'].includes(data.status))
    return null;
  const dismiss = () => {
    setFailed(false);
    void introSeen().catch(() => setFailed(true));
  };
  const classic = data.classic ? (
    <View testID="league-classic-plaque" style={styles.plaque}>
      <LeagueCard league="deuce" size={30} />
      <PidroText role="metadata" style={styles.copy}>
        {t('league.intro_classic')}
      </PidroText>
    </View>
  ) : null;
  return (
    <Modal
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      animationType={reduceMotion ? 'none' : 'fade'}
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={() => {}}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe}>
          <View
            testID="league-intro"
            accessibilityViewIsModal
            style={[
              styles.sheet,
              !short && styles.tall,
              short && styles.short,
              wide && styles.wide,
            ]}>
            <View style={[styles.picture, wide && styles.side]}>
              {!short ? (
                <View style={styles.fan}>
                  {LEAGUES.map(({ id }, index) => (
                    <View
                      key={id}
                      style={[
                        styles.fanCard,
                        {
                          left: index * 45,
                          top: Math.abs(2 - index) * 6,
                          transform: [{ rotate: `${(index - 2) * 7}deg` }],
                        },
                      ]}>
                      <LeagueCard league={id} size={54} />
                    </View>
                  ))}
                </View>
              ) : null}
              <PidroText
                role="display"
                tone="gold"
                style={styles.title}
                align="center"
                accessibilityRole="header">
                {t('league.intro_title')}
              </PidroText>
              {!short || wide ? (
                <PidroText role="body" tone="soft" align="center">
                  {t('league.intro_ladder')}
                </PidroText>
              ) : null}
              {wide ? classic : null}
            </View>
            <View
              style={[
                styles.body,
                !short && styles.tallBody,
                short && styles.short,
                wide && styles.wideBody,
              ]}>
              <View style={[styles.steps, short && styles.short]}>
                {(['play', 'race', 'move'] as const).map((step, index) => (
                  <View key={step} style={styles.step}>
                    <Surface variant="subtle" style={styles.number}>
                      <PidroText role="label">{index + 1}</PidroText>
                    </Surface>
                    <View style={styles.copy}>
                      <PidroText role="label">{t(`league.intro_${step}`)}</PidroText>
                      <PidroText role="metadata" tone="soft">
                        {t(`league.intro_${step}_body`)}
                      </PidroText>
                    </View>
                  </View>
                ))}
              </View>
              {!wide ? classic : null}
              {failed ? (
                <PidroText role="metadata" tone="danger" accessibilityRole="alert">
                  {t('league.failed')}
                </PidroText>
              ) : null}
              <View style={styles.action}>
                <BevelButton
                  testID="league-got-it"
                  label={t('league.got_it')}
                  fullWidth
                  loading={busy}
                  onPress={dismiss}
                />
              </View>
            </View>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: PidroColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    padding: PidroSpacing.md,
  },
  sheet: { width: '100%', maxWidth: 436, maxHeight: '100%', gap: 24, padding: 4 },
  tall: { height: '90%' },
  tallBody: { flex: 1 },
  action: { marginTop: 'auto' },
  title: { fontFamily: PidroFonts.display, fontWeight: '400', lineHeight: 42 },
  short: { gap: 12 },
  wide: { flexDirection: 'row', maxWidth: 840, gap: 28 },
  picture: { alignItems: 'center', gap: PidroSpacing.sm },
  side: { flex: 1, justifyContent: 'center' },
  fan: { width: 236, height: 104 },
  fanCard: { position: 'absolute' },
  body: { flexShrink: 1, gap: PidroSpacing.md },
  wideBody: { flex: 1 },
  steps: { gap: 14 },
  step: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  number: {
    width: 40,
    height: 40,
    borderRadius: PidroRadii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  plaque: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: PidroRadii.surface,
    backgroundColor: PidroColors.warningBg,
    borderWidth: 1,
    borderColor: PidroColors.warning,
  },
});
