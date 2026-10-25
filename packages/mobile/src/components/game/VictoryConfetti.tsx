import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { PidroColors, PidroGameOver } from '@/design/tokens';
import { isStillCapture } from '@/utils/stillCapture';

const COLORS = [PidroGameOver.ours, PidroColors.text, PidroGameOver.theirs, PidroColors.cyanText];
const SUITS = ['♥', '♠', '♦', '♣'];
// Fixed trajectories keep renders stable. One short burst of suits, never an
// ambient loop; every fifth piece is a little card.
const PIECES = Array.from({ length: 28 }, (_, index) => ({
  x: (index * 37) % 100,
  drift: ((index * 19) % 70) - 35,
  delay: (index % 7) * 0.025,
  travel: 0.45 + (index % 7) * 0.07,
  turn: index % 2 === 0 ? 260 : -220,
  size: 11 + ((index * 5) % 10),
  suit: SUITS[index % SUITS.length],
  color: COLORS[index % COLORS.length],
  card: index % 5 === 0,
}));

export function VictoryConfetti() {
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const [finished, setFinished] = useState(false);
  const { height } = useWindowDimensions();

  useEffect(() => {
    if (reducedMotion) return;
    // The suits fall once the score has landed (the 1 s beat).
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 2600,
      delay: 900,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start(({ finished: completed }) => {
      if (completed) setFinished(true);
    });
    return () => animation.stop();
  }, [progress, reducedMotion]);

  if (reducedMotion || finished) return null;
  return (
    <View
      testID="victory-confetti"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.layer}>
      {PIECES.map((piece, index) => (
        <Animated.View
          key={index}
          style={[
            styles.piece,
            {
              left: `${piece.x}%`,
              opacity: progress.interpolate({
                inputRange: [0, piece.delay + 0.01, 0.7, 1],
                outputRange: [0, 1, 1, 0],
              }),
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [piece.delay, 1],
                    outputRange: [-24, height * piece.travel],
                    extrapolate: 'clamp',
                  }),
                },
                { translateX: Animated.multiply(progress, piece.drift) },
                {
                  rotate: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', `${piece.turn}deg`],
                  }),
                },
              ],
            },
          ]}>
          {piece.card ? (
            <View style={styles.card} />
          ) : (
            <Animated.Text
              style={{ color: piece.color, fontSize: piece.size, lineHeight: piece.size * 1.1 }}>
              {piece.suit}
            </Animated.Text>
          )}
        </Animated.View>
      ))}
    </View>
  );
}

const RAY_COUNT = 24;

/**
 * Gold rays turning slowly behind a spotlight, centred on `center`. A lap is
 * 60 s; reduced motion hides them unless `still` is requested. Captures hold them.
 */
export function VictoryRays({
  center,
  size,
  still = false,
}: {
  center: { x: number; y: number };
  size: number;
  still?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (still || reducedMotion || isStillCapture()) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 60_000,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      })
    );
    loop.start();
    return () => loop.stop();
  }, [still, reducedMotion, spin]);

  if (reducedMotion && !still) return null;
  const r = size / 2;
  const wedge = (index: number) => {
    const from = ((index * 360) / RAY_COUNT) * (Math.PI / 180);
    const to = from + (5 * Math.PI) / 180;
    return `M${r},${r}L${r + r * Math.cos(from)},${r + r * Math.sin(from)}L${r + r * Math.cos(to)},${r + r * Math.sin(to)}Z`;
  };
  const spot = size * 0.42;
  return (
    <View
      testID="victory-rays"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.layer}>
      <Animated.View
        style={{
          position: 'absolute',
          left: center.x - r,
          top: center.y - r,
          width: size,
          height: size,
          transform: [
            { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          ],
        }}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="ray" cx={r} cy={r} r={r} gradientUnits="userSpaceOnUse">
              <Stop
                offset="0"
                stopColor={PidroGameOver.ray}
                stopOpacity={PidroGameOver.rayOpacity}
              />
              <Stop
                offset="0.5"
                stopColor={PidroGameOver.ray}
                stopOpacity={PidroGameOver.rayOpacity * 0.6}
              />
              <Stop offset="1" stopColor={PidroGameOver.ray} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          {Array.from({ length: RAY_COUNT }, (_, index) => (
            <Path key={index} d={wedge(index)} fill="url(#ray)" />
          ))}
        </Svg>
      </Animated.View>
      <Svg
        width={spot * 2}
        height={spot * 2}
        style={{ position: 'absolute', left: center.x - spot, top: center.y - spot }}>
        <Defs>
          <RadialGradient id="spot" cx={spot} cy={spot} r={spot} gradientUnits="userSpaceOnUse">
            <Stop
              offset="0"
              stopColor={PidroGameOver.spot}
              stopOpacity={PidroGameOver.spotOpacity}
            />
            <Stop offset="0.55" stopColor={PidroGameOver.ray} stopOpacity={0.15} />
            <Stop offset="1" stopColor={PidroGameOver.ray} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={spot} cy={spot} r={spot} fill="url(#spot)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  piece: { position: 'absolute', top: 0 },
  card: {
    width: 9,
    height: 13,
    borderRadius: 2,
    backgroundColor: PidroColors.leagueCardFace,
  },
});
