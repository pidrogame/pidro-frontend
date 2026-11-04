/**
 * A small red count: on a tab, or beside a section title. Nothing at zero,
 * 99+ past 99. The sm badge sits on a control, so it wears a navy edge to
 * cut it out of what is behind it; that control says the count in its own
 * accessibility label too. `online` is the green count of people here now,
 * with a light dot before the number.
 */
import { StyleSheet, View } from 'react-native';
import { PidroBevel, PidroColors, PidroRadii } from '@/design/tokens';
import { countBadgeText } from '@/features/countBadge';
import { PidroText } from './PidroText';

export interface CountBadgeProps {
  count: number;
  size?: 'md' | 'sm';
  tone?: 'alert' | 'online';
}

export function CountBadge({ count, size = 'md', tone = 'alert' }: CountBadgeProps) {
  const text = countBadgeText(count);
  if (!text) return null;
  const sm = size === 'sm';
  const online = tone === 'online';
  return (
    <View
      pointerEvents="none"
      style={[styles.badge, sm ? styles.sm : styles.md, online && styles.online]}>
      {online ? <View style={styles.dot} /> : null}
      <PidroText
        maxFontSizeMultiplier={1.2}
        style={[styles.text, sm ? styles.smText : styles.mdText, online && styles.onlineText]}>
        {text}
      </PidroText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PidroRadii.full,
    backgroundColor: PidroColors.countBadge,
  },
  md: { minWidth: 20, height: 20, paddingHorizontal: 6 },
  sm: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderWidth: 1.5,
    borderColor: PidroBevel.panelDeep,
  },
  text: {
    color: PidroColors.text,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0,
  },
  mdText: { fontSize: 11, lineHeight: 14 },
  smText: { fontSize: 10, lineHeight: 12 },
  online: { gap: 3, paddingLeft: 4, backgroundColor: PidroColors.onlineCount },
  onlineText: { color: PidroColors.onlineCountInk },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: PidroColors.onlineCountDot },
});
