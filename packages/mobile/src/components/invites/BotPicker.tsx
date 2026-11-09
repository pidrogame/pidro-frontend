import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { BotProfile } from '@pidro/shared';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { PidroBevel, PidroColors, PidroRadii } from '@/design/tokens';
import { botLine } from '@/features/lobby/newTable';
import { useTranslation } from '@/i18n';
import { playSelectionHaptic } from '@/utils/haptics';

export interface BotPickerProps {
  /** The rule set's own characters, then everyone at home anywhere; none already at the table. */
  regulars: readonly BotProfile[];
  club: readonly BotProfile[];
  /** Where Anyone turns up from: the rule set's region. */
  region: string;
  /** Who sits in the seat now; null is anyone. */
  selected: string | null;
  /** The wood button: the caller sends the seat, the container closes. */
  onSeat: (persona: string | null) => void;
  columns?: 1 | 2;
}

/** Who sits in a bot seat, by face. One tap selects a row; the button seats them. */
export function BotPicker({
  regulars,
  club,
  region,
  selected,
  onSeat,
  columns = 1,
}: BotPickerProps) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState(selected);
  const all = [...regulars, ...club];
  const pick = all.find((bot) => bot.id === chosen);
  const row = (id: string | null, name: string, line: string, odds: boolean, bot?: BotProfile) => {
    const checked = (pick?.id ?? null) === id;
    return (
      <View key={id ?? 'anyone'} style={columns === 2 ? styles.half : styles.full}>
        <PressableFX
          accessibilityRole="radio"
          accessibilityLabel={`${name}, ${line}`}
          accessibilityState={{ checked }}
          aria-checked={checked}
          onPress={() => {
            playSelectionHaptic();
            setChosen(id);
          }}
          style={[styles.row, checked && styles.selected]}
          pressedStyle={styles.pressed}>
          <PlayerAvatar
            size={40}
            kind="bot"
            persona={bot?.id ?? null}
            botProfile={bot ?? null}
            accessibilityLabel=""
          />
          <View style={styles.copy}>
            <PidroText role="label" numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {name}
            </PidroText>
            <PidroText
              role="metadata"
              tone={odds ? 'gold' : 'soft'}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}>
              {line}
            </PidroText>
          </View>
          <View style={[styles.radio, checked && styles.checked]}>
            {checked && <View style={styles.dot} />}
          </View>
        </PressableFX>
      </View>
    );
  };
  const group = (title: string, bots: readonly BotProfile[]) =>
    bots.length > 0 && (
      <>
        <PidroText role="eyebrow" tone="cyan" style={styles.heading}>
          {title}
        </PidroText>
        {bots.map((bot) => {
          const line = botLine(bot);
          return row(bot.id, bot.name, line.text, line.odds, bot);
        })}
      </>
    );
  return (
    <View testID="bot-picker" style={styles.picker}>
      <ScrollView
        testID="bot-picker-scroll"
        accessibilityRole="radiogroup"
        style={styles.scroll}
        contentContainerStyle={styles.list}>
        {row(null, t('picker.anyone'), t('picker.anyone_from', { region }), false)}
        {group(t('picker.regulars'), regulars)}
        {group(t('picker.club'), club)}
      </ScrollView>
      <BevelButton
        label={pick ? t('picker.seat_bot', { name: pick.name }) : t('picker.anyone_sits')}
        size="lg"
        fullWidth
        onPress={() => onSeat(pick?.id ?? null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { flex: 1, minHeight: 0, gap: 12 },
  scroll: { flex: 1, minHeight: 0 },
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 4 },
  heading: { width: '100%', paddingHorizontal: 8, paddingTop: 6 },
  full: { width: '100%' },
  half: { width: '49%', flexGrow: 1, flexBasis: '47%', maxWidth: '50%' },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: PidroRadii.lg,
    borderWidth: 1,
    borderColor: PidroColors.border,
    backgroundColor: PidroColors.panelSoft,
  },
  selected: { borderColor: PidroBevel.rim, backgroundColor: PidroColors.goldSoft },
  pressed: { backgroundColor: PidroColors.actionPill },
  copy: { flex: 1, minWidth: 0 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: PidroRadii.full,
    borderWidth: 2,
    borderColor: PidroColors.radioOff,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: { borderColor: PidroBevel.rim },
  dot: {
    width: 12,
    height: 12,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroBevel.textGold,
  },
});
