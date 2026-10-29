/**
 * DEV ONLY: tune a table moment's timings live and replay it. Each change
 * replays at once; the link takes the same keys (`holdMs=3000`, `showMs=6000`,
 * …) so a setting can be shared. `/table-dev?deal=draw` tunes the second
 * deal, `/table-dev?deal=hand` the end of a hand.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PidroBevel, PidroColors, PidroFonts, PidroLayout, PidroSpacing } from '@/design/tokens';
import {
  resetSecondDealTiming,
  secondDealDurationMs,
  secondDealTiming,
  setSecondDealTiming,
  type SecondDealTiming,
} from '@/game/canvas/animationTiming';
import {
  HAND_RESULT_DEFAULTS,
  handResultTiming,
  setHandResultTiming,
} from '@/features/game/handResult';

type Row = { key: string; label: string; step: number };
type Timing = Record<string, number>;

const SECOND_DEAL_ROWS: Row[] = [
  { key: 'throwGapMs', label: 'Between throws', step: 50 },
  { key: 'holdMs', label: 'Piles to count', step: 250 },
  { key: 'packMs', label: 'Piles clear, pack', step: 50 },
  { key: 'cardMs', label: 'Each dealt card', step: 20 },
  { key: 'seatGapMs', label: 'Between players', step: 50 },
  { key: 'robMs', label: 'Dealer takes rest', step: 50 },
  { key: 'startMs', label: 'Before first throw', step: 50 },
];
const HAND_RESULT_ROWS: Row[] = [{ key: 'showMs', label: 'Result on screen', step: 500 }];

/** Applies `key=ms` values from the link to the live timings. */
export function applyTimingParams(params: Record<string, string | string[] | undefined>) {
  const read = (key: string) => {
    const raw = params[key];
    const value = Number(Array.isArray(raw) ? raw[0] : raw);
    return raw != null && Number.isFinite(value) && value >= 0 ? value : null;
  };
  for (const { key } of SECOND_DEAL_ROWS) {
    const value = read(key);
    if (value != null) setSecondDealTiming({ [key]: value });
  }
  const show = read('showMs');
  if (show != null) setHandResultTiming({ showMs: show });
}

export function SecondDealTuner({ dealt, onReplay }: { dealt: number; onReplay: () => void }) {
  return (
    <TimingTuner
      rows={SECOND_DEAL_ROWS}
      timing={secondDealTiming as unknown as Timing}
      set={(next) => setSecondDealTiming(next as Partial<SecondDealTiming>)}
      reset={resetSecondDealTiming}
      total={() => `Whole second deal: ${(secondDealDurationMs(dealt) / 1000).toFixed(1)}s`}
      onReplay={onReplay}
    />
  );
}

export function HandResultTuner({ onReplay }: { onReplay: () => void }) {
  return (
    <TimingTuner
      rows={HAND_RESULT_ROWS}
      timing={handResultTiming}
      set={setHandResultTiming}
      reset={() => setHandResultTiming(HAND_RESULT_DEFAULTS)}
      total={() => 'Then the next hand is dealt'}
      onReplay={onReplay}
    />
  );
}

function TimingTuner({
  rows,
  timing,
  set,
  reset,
  total,
  onReplay,
}: {
  rows: Row[];
  timing: Timing;
  set: (next: Timing) => void;
  reset: () => void;
  total: () => string;
  onReplay: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [, setVersion] = useState(0);
  const change = (key: string, delta: number) => {
    set({ [key]: Math.max(0, timing[key] + delta) });
    setVersion((v) => v + 1);
    onReplay();
  };
  const resetAll = () => {
    reset();
    setVersion((v) => v + 1);
    onReplay();
  };

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      {open ? (
        <View style={styles.panel}>
          {rows.map(({ key, label, step }) => (
            <View key={key} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Less ${label}`}
                onPress={() => change(key, -step)}
                style={styles.step}>
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Text style={styles.value}>{timing[key]}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`More ${label}`}
                onPress={() => change(key, step)}
                style={styles.step}>
                <Text style={styles.stepText}>+</Text>
              </Pressable>
            </View>
          ))}
          <View style={styles.row}>
            <Text style={styles.label}>{total()}</Text>
            <Pressable accessibilityRole="button" onPress={resetAll} style={styles.small}>
              <Text style={styles.stepText}>Reset</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" onPress={onReplay} style={styles.small}>
          <Text style={styles.stepText}>Replay</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen((o) => !o)}
          style={styles.small}>
          <Text style={styles.stepText}>{open ? 'Done' : 'Tune'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 96,
    alignItems: 'flex-start',
    gap: 8,
    zIndex: 60,
  },
  panel: {
    alignSelf: 'stretch',
    padding: PidroSpacing.sm,
    gap: 6,
    borderRadius: 12,
    backgroundColor: PidroBevel.panelDeep,
    borderWidth: 1,
    borderColor: PidroColors.cyanBorder,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: {
    flex: 1,
    fontFamily: PidroFonts.ui,
    fontWeight: '700',
    fontSize: 14,
    color: PidroColors.text,
  },
  value: {
    width: 56,
    textAlign: 'center',
    fontFamily: PidroFonts.ui,
    fontWeight: '900',
    fontSize: 15,
    color: PidroColors.text,
    fontVariant: ['tabular-nums'],
  },
  step: {
    width: 40,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PidroBevel.panelHi,
  },
  small: {
    minWidth: 72,
    height: PidroLayout.touchTarget,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PidroBevel.panelHi,
  },
  stepText: { fontFamily: PidroFonts.ui, fontWeight: '900', fontSize: 16, color: PidroColors.text },
  buttons: { flexDirection: 'row', gap: 8 },
});
