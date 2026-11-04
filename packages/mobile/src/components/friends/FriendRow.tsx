/**
 * One person with one status line, the same on Friends, Add a friend, the
 * empty state and the seat picker. The avatar and name are one tap target
 * that opens the friend's sheet; one control trails it: an action pill or
 * × passed in (a request has both, as on the board), a quiet "Sent" /
 * "Friends" label, or a chevron. Blocked players have no status line.
 * Presentational: the look comes from `friendRowState`.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar, type AvatarRing } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { PidroBevel, PidroColors, PidroLayout, PidroRadii } from '@/design/tokens';
import type { FriendRowState } from '@/features/friends';
import { useTranslation } from '@/i18n';

export interface FriendRowProps {
  name: string;
  avatarUrl?: string | null;
  ring?: AvatarRing;
  /** The chip under the face: the level, or a Legend's stars. */
  level?: number | null;
  prestige?: number | null;
  row: FriendRowState;
  /** Opens the friend's sheet, or picks them for a seat. */
  onPress?: () => void;
  accessibilityLabel?: string;
  selected?: boolean;
  trailing?: ReactNode | 'chevron' | 'sent' | 'friends';
  /** Greyed and inert, as a busy friend in the seat picker. */
  dimmed?: boolean;
  /** A shorter row with a one-line status, for the seat picker on a sideways phone. */
  dense?: boolean;
}

const LINE_COLOR = {
  green: PidroColors.success,
  gold: PidroBevel.textGold,
  quiet: PidroColors.textSoft,
} as const;

export function FriendRow({
  name,
  avatarUrl,
  ring = 'glass',
  level,
  prestige,
  row,
  onPress,
  accessibilityLabel,
  selected = false,
  trailing,
  dimmed = false,
  dense = false,
}: FriendRowProps) {
  const { t } = useTranslation();
  const identity = (
    <>
      <View style={row.variant === 'sent' && styles.faded}>
        <PlayerAvatar
          size={dense ? 40 : 44}
          uri={avatarUrl}
          ring={ring}
          level={level}
          prestige={prestige}
        />
        {row.dot ? (
          <View style={[styles.dot, row.dot === 'online' ? styles.dotOnline : styles.dotTable]} />
        ) : null}
      </View>
      <View style={styles.copy}>
        <PidroText role="label" numberOfLines={1} maxFontSizeMultiplier={1.3} style={styles.name}>
          {name}
        </PidroText>
        {row.line ? (
          <PidroText
            role="metadata"
            numberOfLines={dense ? 1 : 2}
            maxFontSizeMultiplier={1.3}
            style={[styles.line, { color: LINE_COLOR[row.tone] }]}>
            {row.line}
          </PidroText>
        ) : null}
      </View>
      {trailing === 'chevron' ? (
        <View style={styles.chevron}>
          <Icon name="chevron-right" size={18} strokeWidth={2.4} color={PidroColors.textSoft} />
        </View>
      ) : null}
    </>
  );

  return (
    <View
      style={[
        styles.row,
        row.variant === 'request' && styles.request,
        row.variant === 'sent' && styles.sent,
        row.variant === 'fresh' && styles.fresh,
        selected && styles.selected,
        dimmed && styles.dimmed,
        dense && styles.dense,
      ]}>
      {onPress && !dimmed ? (
        <PressableFX
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? t('friends.view_profile', { name })}
          accessibilityState={{ selected }}
          accessibilityHint={row.line || undefined}
          onPress={onPress}
          style={[styles.identity, dense && styles.denseIdentity]}>
          {identity}
        </PressableFX>
      ) : (
        <View
          accessible
          accessibilityRole={dimmed ? 'button' : undefined}
          accessibilityLabel={row.line ? `${name}, ${row.line}` : name}
          accessibilityState={{ disabled: dimmed }}
          aria-disabled={dimmed || undefined}
          style={[styles.identity, dense && styles.denseIdentity]}>
          {identity}
        </View>
      )}
      {trailing === 'sent' || trailing === 'friends' ? (
        <FriendState state={trailing === 'sent' ? 'sent' : 'friends'} />
      ) : trailing !== 'chevron' ? (
        trailing
      ) : null}
    </View>
  );
}

/** The quiet "Sent" or "Friends" a row, or a profile, shows once nothing is left to tap. */
export function FriendState({ state }: { state: 'sent' | 'friends' }) {
  const { t } = useTranslation();
  return (
    <View style={styles.state}>
      <Icon
        name={state === 'sent' ? 'clock' : 'check'}
        size={16}
        strokeWidth={2.6}
        color={state === 'sent' ? PidroColors.textSoft : PidroColors.success}
      />
      <PidroText
        role="label"
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={state === 'sent' ? styles.stateSent : styles.stateFriends}>
        {t(state === 'sent' ? 'friends.sent' : 'friends.are_friends')}
      </PidroText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 64,
    paddingVertical: 8,
    paddingLeft: 10,
    paddingRight: 6,
    borderRadius: PidroRadii.lg,
    borderWidth: 1,
    borderColor: PidroColors.border,
    backgroundColor: PidroColors.panelSoft,
  },
  request: {
    borderWidth: 1.5,
    borderColor: PidroColors.friendAskBorder,
    backgroundColor: PidroColors.friendAskBg,
  },
  sent: { borderStyle: 'dashed', backgroundColor: PidroColors.friendSentBg },
  fresh: { borderWidth: 1.5, borderColor: PidroColors.presenceOnline },
  selected: { borderColor: PidroBevel.rim, backgroundColor: PidroColors.goldSoft },
  dimmed: { opacity: 0.5 },
  dense: { minHeight: 52, paddingVertical: 3 },
  identity: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  denseIdentity: { minHeight: PidroLayout.touchTarget },
  faded: { opacity: 0.7 },
  dot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 13,
    height: 13,
    borderRadius: PidroRadii.full,
    borderWidth: 2,
    borderColor: PidroBevel.panelDeep,
  },
  dotOnline: { backgroundColor: PidroColors.presenceOnline },
  dotTable: { backgroundColor: PidroBevel.textGold },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  name: { fontSize: 16, lineHeight: 20 },
  line: { fontSize: 13, lineHeight: 17, letterSpacing: 0 },
  chevron: { marginRight: 6 },
  state: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: PidroLayout.touchTarget,
    paddingHorizontal: 10,
    flexShrink: 0,
  },
  stateSent: { color: PidroColors.textSoft },
  stateFriends: { color: PidroColors.success },
});
