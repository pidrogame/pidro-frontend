import { Fragment, memo } from 'react';
import { View, StyleSheet } from 'react-native';
import type { LobbyCategoryKey, Position, Room } from '@pidro/shared';
import { useBotCatalogueStore } from '@pidro/shared';
import { tableRow } from '@/features/lobby/tableRow';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { BevelPressable } from '@/components/ui/Bevel';
import { Surface } from '@/components/ui/Surface';
import { RuleSetChip } from '@/components/rules/RuleSet';
import { PidroBevel, PidroColors, PidroFonts, PidroRadii } from '@/design/tokens';
import { ChairLock, OpenChair } from './OpenChair';
import { SeatRequirementBadge } from './SeatRequirementBadge';
import { useTranslation, formatNumber } from '@/i18n';

export const RoomCard = memo(function RoomCard({
  room,
  category = 'open_tables',
  onJoin,
  onAction,
  error,
  pending,
  gamesPlayed,
  onLocked,
  onPassword,
}: {
  room: Room;
  category?: LobbyCategoryKey;
  onJoin: (code: string, position: Position) => void;
  onAction?: (code: string, category: LobbyCategoryKey) => void;
  error?: string;
  pending?: boolean;
  gamesPlayed?: number;
  onLocked?: (code: string, minimum: number, played: number) => void;
  onPassword?: (code: string, position: Position) => void;
}) {
  const { t } = useTranslation();
  useBotCatalogueStore((state) => state.profiles);
  const row = tableRow(room, category, gamesPlayed);
  const mine = category === 'my_rejoinable';
  return (
    <Surface
      testID={`lobby-table-${room.code}`}
      variant="subtle"
      style={[styles.card, mine && styles.mine]}>
      <View style={styles.top}>
        <View style={styles.side}>
          <RuleSetChip
            ruleSet={room.config?.rule_set ?? 'finnish'}
            compact
            testID={`room-rules-${room.code}`}
          />
        </View>
        <PidroText
          role="label"
          style={[
            styles.status,
            category === 'spectatable'
              ? styles.playing
              : category === 'substitute_needed'
                ? styles.amber
                : styles.gold,
          ]}>
          {row.status}
        </PidroText>
        <View style={[styles.side, styles.action]}>
          {row.button ? (
            <BevelPressable
              material="glass"
              accessibilityRole="button"
              accessibilityLabel={row.button}
              onPress={() => onAction?.(room.code, category)}
              style={styles.button}
              contentStyle={styles.buttonFace}>
              <PidroText role="label" style={[styles.buttonText, mine && styles.gold]}>
                {row.button}
              </PidroText>
            </BevelPressable>
          ) : null}
        </View>
      </View>
      <View style={styles.seats}>
        {row.seats.map((seat, index) => {
          const content = (
            <>
              <View style={seat.kind === 'held' && styles.lockedChair}>
                {seat.kind === 'open' || seat.kind === 'sub' ? (
                  <View style={seat.requirementReason ? styles.lockedChair : undefined}>
                    <OpenChair size={44} substitute={seat.kind === 'sub'} />
                    {seat.password ? <ChairLock /> : null}
                  </View>
                ) : (
                  <PlayerAvatar
                    size={44}
                    uri={seat.avatarUrl}
                    level={seat.level}
                    prestige={seat.prestige}
                    kind={seat.kind === 'bot' ? 'bot' : 'player'}
                    persona={seat.persona}
                    botProfile={seat.botProfile}
                  />
                )}
                {seat.minGames > 0 ? (
                  <SeatRequirementBadge games={seat.minGames} locked={!!seat.requirementReason} />
                ) : null}
              </View>
              <PidroText
                role="metadata"
                numberOfLines={1}
                style={[
                  styles.name,
                  seat.kind === 'open' && styles.open,
                  seat.kind === 'sub' && styles.amber,
                ]}>
                {seat.name}
              </PidroText>
              {seat.kind === 'held' ? (
                <PidroText role="metadata" tone="soft">
                  {t('seat_friend.invited')}
                </PidroText>
              ) : null}
            </>
          );
          const join = t(seat.kind === 'sub' ? 'social.sub_seat' : 'social.join_seat', {
            position: t(`social.${seat.position}`),
          });
          const label = seat.password ? t('social.password_seat', { seat: join }) : join;
          return (
            <Fragment key={seat.position}>
              {index === 2 ? (
                <PidroText role="metadata" style={styles.vs}>
                  {t('social.vs')}
                </PidroText>
              ) : null}
              {seat.canJoin ? (
                <PressableFX
                  accessibilityRole="button"
                  accessibilityLabel={
                    seat.requirementReason
                      ? t('social.locked_seat', {
                          position: t(`social.${seat.position}`),
                          reason: seat.requirementReason,
                        })
                      : seat.minGames > 0
                        ? t('social.seat_minimum', {
                            seat: label,
                            minimum: formatNumber(seat.minGames),
                          })
                        : label
                  }
                  disabled={pending}
                  onPress={() =>
                    seat.requirementReason
                      ? onLocked?.(room.code, seat.minGames, gamesPlayed ?? 0)
                      : seat.password && onPassword
                        ? onPassword(room.code, seat.position)
                        : onJoin(room.code, seat.position)
                  }
                  style={styles.seat}>
                  {content}
                </PressableFX>
              ) : (
                <View style={styles.seat}>{content}</View>
              )}
            </Fragment>
          );
        })}
      </View>
      {error ? (
        <PidroText role="metadata" tone="danger" accessibilityRole="alert">
          {error}
        </PidroText>
      ) : null}
    </Surface>
  );
});

const styles = StyleSheet.create({
  card: {
    width: '100%',
    gap: 8,
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderRadius: PidroRadii.lg,
    backgroundColor: PidroColors.panelSoft,
    borderColor: PidroColors.border,
  },
  mine: { backgroundColor: PidroColors.choiceOn, borderColor: PidroBevel.rim, borderWidth: 1.5 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  side: { flexGrow: 1, flexShrink: 0 },
  action: { alignItems: 'flex-end' },
  status: { textAlign: 'center', flexShrink: 1 },
  gold: { color: PidroBevel.textGold },
  amber: { color: PidroColors.rulesLouisianaText },
  playing: { color: PidroColors.textSoft },
  open: { color: PidroColors.cyanText },
  lockedChair: { opacity: 0.45 },
  button: { minHeight: 44, borderRadius: PidroRadii.lg },
  buttonFace: { paddingHorizontal: 12, minHeight: 40, justifyContent: 'center' },
  buttonText: { fontSize: 13 },
  seats: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 2 },
  seat: { width: 58, gap: 9, alignItems: 'center' },
  name: { width: '100%', textAlign: 'center', fontSize: 12, lineHeight: 15, fontWeight: '800' },
  vs: {
    fontFamily: PidroFonts.display,
    fontSize: 14,
    lineHeight: 44,
    color: PidroColors.textMuted,
    paddingHorizontal: 2,
  },
});
