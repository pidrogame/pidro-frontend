/**
 * The slowly turning shimmer behind the logo — the legacy game's glow,
 * recreated procedurally so it stays resolution-independent and can later
 * breathe (pulse on level-up, brighten on wins). Twelve rays sharing one
 * radial fade, one full turn every 80 seconds. Honors reduced motion.
 */
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { PidroColors } from '@/design/tokens';

const RAY_COUNT = 12;
const RAY_HALF_ANGLE = (5 * Math.PI) / 180;

function rayPaths(radius: number): string[] {
  const paths: string[] = [];
  for (let i = 0; i < RAY_COUNT; i++) {
    const angle = (i / RAY_COUNT) * Math.PI * 2;
    const x1 = radius + Math.cos(angle - RAY_HALF_ANGLE) * radius;
    const y1 = radius + Math.sin(angle - RAY_HALF_ANGLE) * radius;
    const x2 = radius + Math.cos(angle + RAY_HALF_ANGLE) * radius;
    const y2 = radius + Math.sin(angle + RAY_HALF_ANGLE) * radius;
    paths.push(
      `M ${radius},${radius} L ${x1.toFixed(1)},${y1.toFixed(1)} L ${x2.toFixed(1)},${y2.toFixed(1)} Z`
    );
  }
  return paths;
}

export interface LogoGlowProps {
  /** Diameter of the ray disc in px. */
  size?: number;
}

export function LogoGlow({ size = 460 }: LogoGlowProps) {
  const reduceMotion = useReducedMotion();
  // React Native's own driver: each frame turns the view, with no commit behind it.
  const [turns] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(turns, {
        toValue: 1,
        duration: 80_000,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      })
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, turns]);

  const spin = useMemo(
    () => ({
      transform: [
        { rotate: turns.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
      ],
    }),
    [turns]
  );

  const r = size / 2;

  return (
    <View pointerEvents="none" style={styles.stage}>
      <Animated.View style={[{ width: size, height: size }, spin]}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <RadialGradient id="glow-fade" gradientUnits="userSpaceOnUse" cx={r} cy={r} r={r}>
              <Stop offset="0%" stopColor={PidroColors.cyanText} stopOpacity="0.22" />
              <Stop offset="45%" stopColor={PidroColors.cyanText} stopOpacity="0.10" />
              <Stop offset="100%" stopColor={PidroColors.cyanText} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          {rayPaths(r).map((d) => (
            <Path key={d} d={d} fill="url(#glow-fade)" />
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Fill the logo stage and center the disc with flex — immune to the
  // %-plus-negative-margin pitfalls on animated views.
  stage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
