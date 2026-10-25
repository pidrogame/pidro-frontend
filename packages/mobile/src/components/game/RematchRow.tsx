import { StyleSheet, View } from 'react-native';
import type { BotPersona, BotProfile } from '@pidro/shared';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { PidroBevel, PidroColors, PidroGameOver, PidroLayout } from '@/design/tokens';
import { rematchLines, type RematchOther } from '@/features/game/gameOver';
import { t } from '@/i18n';

export type RematchSeatView = RematchOther & {
  avatarUrl?: string | null;
  /** Set when the player has a profile to open. */
  playerId?: string | null;
  persona?: BotPersona | null;
  botProfile?: BotProfile | null;
};

/**
 * The other three players side by side and where each stands on the rematch:
 * in full colour with a green check once they agree, greyed until then. Once
 * you say yes, you join the row first.
 */
export function RematchRow({
  others,
  you,
  youAgreed,
  onProfile,
  scale = 1,
}: {
  others: RematchSeatView[];
  /** Joins the row, first and checked, once you have said yes. */
  you?: RematchSeatView;
  youAgreed: boolean;
  onProfile?: (playerId: string | null, persona?: BotPersona | null) => void;
  scale?: number;
}) {
  const { title, detail } = rematchLines(others, youAgreed);
  const size = Math.round(34 * scale);
  const target = Math.max(PidroLayout.touchTarget, size + 8);
  const seats = youAgreed && you ? [{ ...you, agreed: true }, ...others] : others;
  // Four in a row would push the lines into a third; their tap areas overlap instead.
  const tuck = seats.length > 3 ? { marginLeft: -Math.round(8 * scale) } : null;
  return (
    <View style={styles.row}>
      <View style={styles.seats}>
        {seats.map((other, index) => {
          const avatar = (
            <View style={{ width: size, height: size }}>
              <PlayerAvatar
                size={size}
                uri={other.avatarUrl}
                kind={other.bot ? 'bot' : 'player'}
                persona={other.persona}
                botProfile={other.botProfile}
                ring={other.agreed ? 'gold' : 'glass'}
              />
              {other.agreed ? (
                <View
                  style={[
                    styles.check,
                    { width: size * 0.48, height: size * 0.48, borderRadius: size },
                  ]}>
                  <Icon name="check" size={Math.round(size * 0.32)} color={PidroBevel.panelDeep} />
                </View>
              ) : (
                <View style={[styles.veil, { borderRadius: size / 2 }]} />
              )}
            </View>
          );
          const label = t('friends.view_profile', { name: other.name });
          return (other.playerId || other.persona) && onProfile ? (
            <PressableFX
              key={index}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => onProfile(other.playerId ?? null, other.persona)}
              testID="rematch-seat"
              style={[styles.seat, { width: target, height: target }, index > 0 && tuck]}>
              {avatar}
            </PressableFX>
          ) : (
            <View
              key={index}
              accessible
              accessibilityLabel={other.name}
              testID="rematch-seat"
              style={[styles.seat, { width: target, height: target }, index > 0 && tuck]}>
              {avatar}
            </View>
          );
        })}
      </View>
      {title || detail ? (
        <View testID="rematch-status" accessibilityLiveRegion="polite" style={styles.text}>
          {title ? (
            <PidroText
              role="label"
              numberOfLines={2}
              style={{ fontSize: 16 * scale, lineHeight: 21 * scale }}>
              {title}
            </PidroText>
          ) : null}
          {detail ? (
            <PidroText
              role="body"
              numberOfLines={2}
              style={{ color: PidroColors.textSoft, fontSize: 14 * scale, lineHeight: 19 * scale }}>
              {detail}
            </PidroText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  seats: { flexDirection: 'row' },
  seat: { alignItems: 'center', justifyContent: 'center' },
  check: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PidroColors.success,
    boxShadow: `0px 0px 0px 2px ${PidroBevel.panelDeep}`,
  },
  veil: { ...StyleSheet.absoluteFill, backgroundColor: PidroGameOver.waitingVeil },
  text: { flexShrink: 1, minWidth: 0 },
});
