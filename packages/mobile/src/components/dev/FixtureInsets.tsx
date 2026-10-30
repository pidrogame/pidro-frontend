import type { ReactNode } from 'react';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

const FIXTURE_INSETS: Record<string, EdgeInsets> = {
  island: { top: 59, bottom: 34, left: 0, right: 0 },
  'iphone-17-portrait': { top: 62, bottom: 34, left: 0, right: 0 },
  'iphone-17-landscape': { top: 0, bottom: 21, left: 62, right: 62 },
  'island-left': { top: 0, bottom: 21, left: 59, right: 0 },
  'island-right': { top: 0, bottom: 21, left: 0, right: 59 },
  android: { top: 24, bottom: 48, left: 0, right: 0 },
  'android-buttons': { top: 24, bottom: 48, left: 0, right: 0 },
  'android-gesture': { top: 24, bottom: 24, left: 0, right: 0 },
  // A TCL 5053Y on its side (Android 9): the hidden status bar still reported, the nav bar right.
  'android-landscape': { top: 24, bottom: 0, left: 0, right: 50 },
  none: { top: 0, bottom: 0, left: 0, right: 0 },
};

/**
 * `?safeArea=` fakes insets so a browser can stand in for a device. Without it
 * the harness inherits the REAL ones — a simulator must show real clearances,
 * not reproduce the browser's zero-inset blindness. (Web has no insets either
 * way, so the captured baselines are unaffected.)
 */
export function FixtureInsets({ preset, children }: { preset?: string; children: ReactNode }) {
  if (!preset) return <>{children}</>;
  const insets = FIXTURE_INSETS[preset] ?? FIXTURE_INSETS.none;
  return <SafeAreaInsetsContext.Provider value={insets}>{children}</SafeAreaInsetsContext.Provider>;
}
