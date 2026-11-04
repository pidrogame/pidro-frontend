import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, SlideInRight, useReducedMotion } from 'react-native-reanimated';
import { useGlobalSearchParams, useIsFocused, useNavigation, useRouter } from 'expo-router';
import type { LeagueResult as Result } from '@pidro/shared';
import { BevelButton } from '@/components/ui/BevelButton';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { PidroBevel, PidroColors, PidroFonts, PidroSpacing } from '@/design/tokens';
import {
  leagueMarkName,
  leagueName,
  ordinal,
  resultWeekDate,
  ribbonMonth,
} from '@/features/league';
import { play } from '@/game/sounds';
import { formatNumber, useTranslation } from '@/i18n';
import { playSelectionHaptic, playSuccessHaptic } from '@/utils/haptics';
import { LeagueCard } from './LeagueCard';
import { useLeague } from './LeagueHost';
import { LeagueRibbon, LeagueWeekDots } from './LeagueRibbon';

export function LeagueResult() {
  const { data } = useLeague();
  const focused = useIsFocused();
  if (
    !focused ||
    !data?.intro_seen ||
    !data.pending_result ||
    data.status === 'off' ||
    data.status === 'guest'
  )
    return null;
  return <ResultSheet key={data.pending_result.id} result={data.pending_result} />;
}

function ResultSheet({ result }: { result: Result }) {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const { fixture } = useGlobalSearchParams<{ fixture?: string }>();
  const { busy, resultSeen } = useLeague();
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const short = height < 740;
  const reduceMotion = useReducedMotion();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (result.move === 'up') {
      play('won');
      playSuccessHaptic();
    } else {
      play('card');
      playSelectionHaptic();
    }
  }, [result.move]);
  const dismiss = (meetRoom: boolean) => {
    if (busy) return;
    setFailed(false);
    void resultSeen(result.id)
      .then(() => {
        if (meetRoom && navigation.isFocused())
          router.replace({ pathname: '/league', params: __DEV__ && fixture ? { fixture } : {} });
      })
      .catch(() => setFailed(true));
  };
  const ribbon = result.ribbon;
  return (
    <Modal
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={() => dismiss(false)}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe}>
          <View
            testID="league-result"
            accessibilityViewIsModal
            style={[
              styles.sheet,
              !short && styles.tall,
              short && styles.short,
              wide && styles.wide,
            ]}>
            <View style={[styles.picture, wide && styles.column]}>
              <PidroText role="eyebrow" tone="muted" align="center">
                {t('league.result.week', { date: resultWeekDate(result.week_starts_at) })}
              </PidroText>
              {!short ? (
                <View style={styles.reveal}>
                  <View style={styles.old}>
                    <LeagueCard league={result.old_league} size={64} faded />
                  </View>
                  <View style={styles.arrow}>
                    <Icon name="chevron-right" size={28} color={PidroBevel.textGold} />
                  </View>
                  <Animated.View
                    entering={
                      reduceMotion
                        ? undefined
                        : result.move === 'up'
                          ? SlideInRight.duration(350)
                          : FadeIn.duration(200)
                    }
                    style={styles.new}>
                    <LeagueCard league={result.new_league} size={104} lit />
                  </Animated.View>
                </View>
              ) : (
                <LeagueCard league={result.new_league} size={36} lit />
              )}
              <PidroText
                role="display"
                tone="gold"
                style={styles.title}
                align="center"
                accessibilityRole="header">
                {t(`league.result.${result.move}`, { league: leagueName(result.new_league) })}
              </PidroText>
              <PidroText role="body" tone="soft" align="center">
                {t('league.result.summary', {
                  place: ordinal(result.place),
                  size: result.room_size,
                  league: leagueName(result.old_league),
                  points: formatNumber(result.points),
                })}
              </PidroText>
            </View>
            <View style={[styles.body, !short && styles.tallBody, wide && styles.column]}>
              <Surface variant="subtle" style={styles.ribbonBox}>
                <LeagueRibbon ribbon={ribbon} size={50} />
                <View style={styles.copy}>
                  <PidroText role="label">
                    {t(
                      ribbon.changed
                        ? 'league.result.ribbon_changed'
                        : 'league.result.ribbon_unchanged',
                      {
                        month: ribbonMonth(ribbon.month),
                        league: leagueMarkName(ribbon.league),
                      }
                    )}
                  </PidroText>
                  <LeagueWeekDots ribbon={ribbon} />
                  {ribbon.star || ribbon.star_possible ? (
                    <PidroText role="metadata" tone="soft">
                      {t(
                        ribbon.star
                          ? 'league.result.star_earned'
                          : ribbon.weeks_total - ribbon.weeks_played === 1
                            ? 'league.result.star_next'
                            : 'league.result.star_possible'
                      )}
                    </PidroText>
                  ) : null}
                </View>
              </Surface>
              {failed ? (
                <PidroText role="metadata" tone="danger" accessibilityRole="alert">
                  {t('league.failed')}
                </PidroText>
              ) : null}
              <View style={styles.actions}>
                <BevelButton
                  testID="league-result-continue"
                  label={t('league.result.continue')}
                  fullWidth
                  loading={busy}
                  onPress={() => dismiss(true)}
                />
                <TextLink
                  testID="league-result-close"
                  label={t('league.result.close')}
                  disabled={busy}
                  onPress={() => dismiss(false)}
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
  sheet: { width: '100%', maxWidth: 436, maxHeight: '100%', gap: PidroSpacing.lg },
  tall: { height: '90%' },
  tallBody: { flex: 1 },
  title: { fontFamily: PidroFonts.display, fontWeight: '400', lineHeight: 42 },
  short: { gap: PidroSpacing.sm },
  wide: { flexDirection: 'row', maxWidth: 840 },
  column: { flex: 1, minWidth: 0, justifyContent: 'center' },
  picture: { gap: PidroSpacing.sm, alignItems: 'center' },
  reveal: { width: 220, height: 170 },
  old: { position: 'absolute', left: 6, top: 46, transform: [{ rotate: '-12deg' }] },
  arrow: { position: 'absolute', left: 70, top: 78 },
  new: { position: 'absolute', left: 104, top: 12 },
  body: { gap: PidroSpacing.md },
  ribbonBox: {
    flexDirection: 'row',
    gap: PidroSpacing.md,
    padding: PidroSpacing.md,
    alignItems: 'center',
  },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  actions: { gap: 4, alignItems: 'center', marginTop: 'auto' },
});
