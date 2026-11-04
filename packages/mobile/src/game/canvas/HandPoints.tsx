/**
 * The end of a hand without count help (PID-332), as Classic showed it: the
 * hand's points over the trump mark, ours | theirs, each what that team's
 * score moved by. No panel and no words; own pace waits for a tap anywhere.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PidroText } from '@/components/ui/PidroText';
import { actionTap, pushAttempt } from '@/diagnostics/actions';
import { PidroBevel, PidroColors, PidroFonts, PidroSpacing } from '@/design/tokens';
import { formatNumber, useTranslation } from '@/i18n';
import type { TeamKey } from '@/types/game';
import type { Position } from '@/types/lobby';
import { isStillCapture } from '@/utils/stillCapture';
import { computeLayout } from './layout';
import { teams } from './Scoreboard';
import { useTableSize } from './TableChrome';

const signed = (n: number) => `${n < 0 ? '−' : ''}${formatNumber(Math.abs(n))}`;

export function HandPoints({
  delta,
  youPosition,
  waiting,
  onContinue,
  topReserve = 0,
  bottomReserve = 0,
}: {
  delta: Record<TeamKey, number>;
  /** As the scoreboard reads it: null for a spectator, who reads N/S first. */
  youPosition: Position | null;
  waiting: boolean;
  onContinue?: () => Promise<boolean> | boolean;
  topReserve?: number;
  bottomReserve?: number;
}) {
  const { t } = useTranslation();
  const { width, height } = useTableSize();
  const insets = useSafeAreaInsets();
  const L = useMemo(
    () => computeLayout(width, height, insets, topReserve, bottomReserve),
    [width, height, insets, topReserve, bottomReserve]
  );
  const { us, them } = teams(delta, youPosition);
  const still = useReducedMotion() || isStillCapture();
  const appear = useSharedValue(still ? 1 : 0);
  useEffect(() => {
    if (!still) appear.value = withTiming(1, { duration: 220 });
  }, [still, appear]);
  const style = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ scale: 0.9 + 0.1 * appear.value }],
  }));

  const sent = useRef(false);
  const [pending, setPending] = useState(false);
  const tap = () =>
    actionTap('continue_hand', async () => {
      if (!onContinue || sent.current) {
        pushAttempt('continue_hand').record('blocked', 'pending');
        return;
      }
      sent.current = true;
      setPending(true);
      if (!(await onContinue())) {
        sent.current = false;
        setPending(false);
      }
    });
  // Own pace waits for a tap; a spectator waits for the players.
  const tapToContinue = waiting && !!onContinue;

  // Digits about as tall as a card's corner rank, or larger.
  const fontSize = Math.round(Math.max(28, L.cardH * 0.34));
  const figure = { fontSize, lineHeight: Math.round(fontSize * 1.3) };
  const label = t('game.hand_points_accessibility', {
    usLabel: youPosition ? t('game.us') : t('game.ns_short'),
    us: signed(us),
    themLabel: youPosition ? t('game.them') : t('game.ew_short'),
    them: signed(them),
  });
  return (
    <View
      testID="hand-points"
      style={[StyleSheet.absoluteFill, styles.root]}
      pointerEvents="box-none">
      {tapToContinue ? (
        <Pressable
          testID="hand-points-continue"
          accessibilityRole="button"
          accessibilityLabel={t('game.tap_to_continue')}
          accessibilityState={{ disabled: pending }}
          onPress={tap}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <Animated.View
        pointerEvents="none"
        accessible
        accessibilityLabel={label}
        accessibilityLiveRegion="polite"
        style={[
          styles.center,
          { left: 0, right: 0, top: L.trick.cy - figure.lineHeight / 2 },
          style,
        ]}>
        <View style={styles.row}>
          <PidroText
            role="display"
            style={[styles.figure, figure, { color: PidroColors.teamUs }]}
            maxFontSizeMultiplier={1}>
            {signed(us)}
          </PidroText>
          <View style={[styles.bar, { height: fontSize * 0.8 }]} />
          <PidroText
            role="display"
            style={[styles.figure, figure, { color: PidroColors.teamThem }]}
            maxFontSizeMultiplier={1}>
            {signed(them)}
          </PidroText>
        </View>
        {tapToContinue ? (
          <PidroText role="metadata" tone="soft" align="center">
            {t('game.tap_to_continue')}
          </PidroText>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Like the result panel: under the score header and the menu, over the felt and the seats.
  root: { zIndex: 40 },
  center: { position: 'absolute', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.sm },
  figure: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    letterSpacing: 0,
    ...PidroBevel.labelShadow,
  },
  bar: { width: 2, borderRadius: 1, backgroundColor: PidroColors.text },
});
