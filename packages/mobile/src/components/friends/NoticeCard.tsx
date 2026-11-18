/**
 * A friend notice: one person, one or two lines, and up to two buttons side
 * by side, wood for the answer and glass for the other. The edge says what
 * kind it is: gold asks you something, green is good news, cyan is the
 * host's, dashed is too late. It enters and leaves like the shell's update
 * notice and honours Reduce Motion. Where it floats and when is PID-246.
 */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown, useReducedMotion } from 'react-native-reanimated';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar, type AvatarRing } from '@/components/ui/PlayerAvatar';
import { PidroBevel, PidroColors, PidroLayout, PidroRadii } from '@/design/tokens';

export type NoticeVariant = 'request' | 'accepted' | 'seat' | 'cant_come' | 'too_late';

interface NoticeAction {
  label: string;
  onPress: () => void;
  loading?: boolean;
}

export interface NoticeCardProps {
  variant: NoticeVariant;
  title: string;
  body?: string;
  avatarUrl?: string | null;
  ring?: AvatarRing;
  /** The wood answer. */
  primary?: NoticeAction;
  /** The glass one; alone, it takes the full width. */
  secondary?: NoticeAction;
  /** A small centred line under the buttons. */
  footnote?: string;
  /** One row, the words and then the buttons, no avatar: for a short landscape screen. */
  row?: boolean;
  /** The footnote beside the avatar, under the words, and less air: for a tight phone (PID-470). */
  compact?: boolean;
  testID?: string;
}

export function NoticeCard({
  variant,
  title,
  body,
  avatarUrl,
  ring = 'glass',
  primary,
  secondary,
  footnote,
  row = false,
  compact = false,
  testID,
}: NoticeCardProps) {
  const reduceMotion = useReducedMotion();
  const late = variant === 'too_late';
  const actions = primary || secondary;

  return (
    <Animated.View
      testID={testID}
      entering={reduceMotion ? undefined : FadeInDown.duration(200)}
      exiting={reduceMotion ? undefined : FadeOutDown.duration(160)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.card, row && styles.row, compact && styles.compact, styles[variant]]}>
      <View style={[styles.person, row && styles.grow]}>
        {row ? null : (
          <View style={(late || variant === 'cant_come') && styles.dim}>
            <PlayerAvatar size={44} uri={avatarUrl} ring={ring} />
          </View>
        )}
        <View style={styles.copy}>
          <PidroText role="label" style={[styles.title, late && styles.lateTitle]}>
            {title}
          </PidroText>
          {body ? (
            <PidroText role="metadata" style={styles.body}>
              {body}
            </PidroText>
          ) : null}
          {(row || compact) && footnote ? (
            <PidroText role="metadata" style={styles.body}>
              {footnote}
            </PidroText>
          ) : null}
        </View>
      </View>
      {actions ? (
        <View style={[styles.actions, row && styles.rowActions]}>
          {primary ? (
            <BevelButton
              label={primary.label}
              material="wood"
              size="sm"
              loading={primary.loading}
              onPress={primary.onPress}
              style={styles.action}
            />
          ) : null}
          {secondary ? (
            <BevelButton
              label={secondary.label}
              material="glass"
              size="sm"
              loading={secondary.loading}
              onPress={secondary.onPress}
              style={styles.action}
            />
          ) : null}
        </View>
      ) : null}
      {footnote && !row && !compact ? (
        <PidroText role="metadata" align="center" style={styles.body}>
          {footnote}
        </PidroText>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: PidroLayout.contentMaxWidth,
    gap: 12,
    padding: 14,
    borderRadius: PidroRadii.xl,
    borderWidth: 1.5,
    backgroundColor: PidroColors.noticeFace,
    boxShadow: PidroColors.noticeShadow,
  },
  request: { borderColor: PidroBevel.rim },
  seat: { borderColor: PidroBevel.rim },
  accepted: { borderColor: PidroColors.presenceOnline },
  cant_come: { borderColor: PidroColors.noticeCyanBorder },
  too_late: {
    borderStyle: 'dashed',
    borderColor: PidroColors.noticeQuietBorder,
    backgroundColor: PidroColors.friendSentBg,
  },
  row: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  compact: { gap: 8, paddingVertical: 10 },
  grow: { flex: 1, minWidth: 0 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dim: { opacity: 0.6 },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 16, lineHeight: 21 },
  lateTitle: { color: PidroColors.textSoft },
  body: { fontSize: 13, lineHeight: 17, letterSpacing: 0, color: PidroColors.textSoft },
  actions: { flexDirection: 'row', gap: 8 },
  rowActions: { minWidth: 248 },
  // Each label first, then the rest shared: a long name never clips the wood.
  action: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' },
});
