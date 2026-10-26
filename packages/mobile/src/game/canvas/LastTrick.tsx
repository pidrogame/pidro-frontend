/**
 * "Last trick", under the plaque's ticker when the player asked for count
 * help (PID-220): tap it to see the trick taken last, its cards in the order
 * played, who took it and what it was worth. It steps aside when it becomes
 * your turn, as the hand log does.
 */
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { PidroColors, PidroLayout, PidroRadii, PidroSpacing } from '@/design/tokens';
import type { Card } from '@/types/game';
import { getCardImage } from '@/utils/cardImages';
import { presentHandLogEntry, type HandLogEntry } from '@/game/handLog';
import { useTranslation } from '@/i18n';
import { TableUtilityWindow } from './TableUtilityWindow';

export type LastTrickView = {
  number: number;
  plays: { name: string; card: Card; took: boolean }[];
  /** The hand log's words for the take and the 2 of trump. */
  lines: HandLogEntry[];
};

const CARD_W = 52;

export function LastTrick({ trick, yourTurn }: { trick: LastTrickView; yourTurn: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [turnSeen, setTurnSeen] = useState(yourTurn);
  if (yourTurn !== turnSeen) {
    setTurnSeen(yourTurn);
    if (yourTurn) setOpen(false);
  }
  return (
    <>
      <PressableFX
        testID="last-trick"
        accessibilityRole="button"
        accessibilityLabel={t('game.last_trick_accessibility', { number: trick.number })}
        onPress={() => setOpen(true)}
        style={styles.target}>
        <View style={styles.pill}>
          <PidroText role="metadata" tone="soft" style={styles.text} maxFontSizeMultiplier={1.3}>
            {t('game.last_trick')}
          </PidroText>
        </View>
      </PressableFX>
      <TableUtilityWindow
        title={t('game.trick', { number: trick.number })}
        open={open}
        onClose={() => setOpen(false)}>
        <View style={styles.cards} testID="last-trick-cards">
          {trick.plays.map((play) => (
            <View key={`${play.name}-${play.card.suit}-${play.card.rank}`} style={styles.play}>
              <Image
                source={getCardImage(play.card)}
                accessibilityIgnoresInvertColors
                style={[styles.card, play.took ? styles.took : null]}
              />
              <PidroText
                role="metadata"
                tone={play.took ? 'gold' : 'soft'}
                align="center"
                numberOfLines={1}
                style={styles.name}>
                {play.name}
              </PidroText>
            </View>
          ))}
        </View>
        {trick.lines.map((line) => (
          <PidroText key={line.id} role="label" style={line.ours ? styles.ours : null}>
            {presentHandLogEntry(line).text}
          </PidroText>
        ))}
      </TableUtilityWindow>
    </>
  );
}

const styles = StyleSheet.create({
  target: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: PidroLayout.touchTarget,
    minWidth: PidroLayout.touchTarget,
  },
  pill: {
    paddingHorizontal: PidroSpacing.xs,
    paddingVertical: 1,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroColors.trickChipBg,
    borderWidth: 1,
    borderColor: PidroColors.border,
  },
  text: { fontWeight: '800' },
  cards: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: PidroSpacing.sm,
    paddingVertical: PidroSpacing.xs,
  },
  play: { width: CARD_W + PidroSpacing.sm, alignItems: 'center', gap: PidroSpacing.xxs },
  card: {
    width: CARD_W,
    height: CARD_W * (110 / 78),
    borderRadius: PidroRadii.tight,
  },
  took: { borderWidth: 2, borderColor: PidroColors.gold },
  name: { alignSelf: 'stretch' },
  ours: { color: PidroColors.teamUs },
});
