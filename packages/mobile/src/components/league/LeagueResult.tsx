import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, SlideInRight, useReducedMotion } from 'react-native-reanimated';
import { useGlobalSearchParams, useIsFocused, useNavigation, useRouter } from 'expo-router';
import type { LeagueResult as Result } from '@pidro/shared';
import { BevelButton } from '@/components/ui/BevelButton';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PidroBevel, PidroColors, PidroSpacing } from '@/design/tokens';
import { ordinal, shouldShowLeagueResult } from '@/features/league';
import { play } from '@/game/sounds';
import { useTranslation } from '@/i18n';
import { playSelectionHaptic, playSuccessHaptic } from '@/utils/haptics';
import { LeagueCard } from './LeagueCard';
import { useLeague } from './LeagueHost';

export function LeagueResult() {
  const { data } = useLeague();
  const focused = useIsFocused();
  if (
    !focused ||
    !data?.pending_result ||
    !shouldShowLeagueResult(data.pending_result) ||
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
  const reduceMotion = useReducedMotion();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    play(result.move === 'up' ? 'won' : 'card');
    if (result.move === 'up') playSuccessHaptic();
    else playSelectionHaptic();
  }, [result.move]);
  const dismiss = (continueToBoard: boolean) => {
    if (busy) return;
    setFailed(false);
    void resultSeen(result.id)
      .then(() => {
        if (continueToBoard && navigation.isFocused())
          router.replace({ pathname: '/league', params: __DEV__ && fixture ? { fixture } : {} });
      })
      .catch(() => setFailed(true));
  };
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
          <Pressable
            testID="league-result-backdrop"
            accessible={false}
            style={StyleSheet.absoluteFill}
            onPress={() => dismiss(false)}
          />
          <View
            testID="league-result"
            accessibilityViewIsModal
            style={[styles.sheet, wide && styles.wide]}>
            <View style={styles.reveal}>
              <View style={styles.old}>
                <LeagueCard league={result.old_league} size={56} faded />
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
                <LeagueCard league={result.new_league} size={88} lit />
              </Animated.View>
            </View>
            <View style={styles.copy}>
              <PidroText role="display" tone="gold" align="center" accessibilityRole="header">
                {t(result.move === 'up' ? 'league.result.up' : 'league.result.down')}
              </PidroText>
              <PidroText role="body" tone="soft" align="center">
                {t('league.result.place', { place: ordinal(result.place), size: result.room_size })}
              </PidroText>
              {failed ? (
                <PidroText role="metadata" tone="danger" accessibilityRole="alert">
                  {t('league.failed')}
                </PidroText>
              ) : null}
              <BevelButton
                testID="league-result-continue"
                label={t('league.result.continue')}
                fullWidth
                loading={busy}
                onPress={() => dismiss(true)}
              />
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
  sheet: { width: '100%', maxWidth: 436, gap: PidroSpacing.lg, alignItems: 'center' },
  wide: { flexDirection: 'row', maxWidth: 720 },
  reveal: { width: 220, height: 160 },
  old: { position: 'absolute', left: 6, top: 46, transform: [{ rotate: '-12deg' }] },
  arrow: { position: 'absolute', left: 70, top: 78 },
  new: { position: 'absolute', left: 104, top: 12 },
  copy: { flexShrink: 1, width: '100%', gap: PidroSpacing.lg, alignItems: 'center' },
});
