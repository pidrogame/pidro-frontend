/**
 * "+4" on the corner of a hand's backs (PID-452): what that seat drew in the
 * second deal, only for players who asked the game to count. A dark pill, a
 * pale ring and the number; `x` and `y` are where its centre sits. It fades
 * in and out as the table's other pieces do.
 */
import { useEffect } from 'react';
import Animated, {
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { StyleSheet } from 'react-native';
import { PidroText } from '@/components/ui/PidroText';
import { PidroBevel, PidroColors, PidroFonts } from '@/design/tokens';

export const DREW_CHIP_H = 22;
const SLOT = 48;
const FADE_MS = 200;

export function DrewChip({
  count,
  x,
  y,
  testID,
}: {
  count: number;
  x: number;
  y: number;
  testID?: string;
}) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(1, { duration: FADE_MS });
  }, [opacity]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      exiting={FadeOut.duration(FADE_MS)}
      style={[styles.slot, { left: x - SLOT / 2, top: y - DREW_CHIP_H / 2 }, fade]}>
      <PidroText maxFontSizeMultiplier={1} style={styles.chip}>
        {`+${count}`}
      </PidroText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', width: SLOT, height: DREW_CHIP_H, alignItems: 'center' },
  chip: {
    minWidth: 32,
    height: DREW_CHIP_H,
    lineHeight: DREW_CHIP_H - 4,
    paddingHorizontal: 6,
    borderRadius: DREW_CHIP_H / 2,
    borderWidth: 2,
    borderColor: PidroColors.cyanText,
    backgroundColor: PidroBevel.panelDeep,
    overflow: 'hidden',
    color: PidroColors.text,
    fontFamily: PidroFonts.ui,
    fontWeight: '900',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
});
