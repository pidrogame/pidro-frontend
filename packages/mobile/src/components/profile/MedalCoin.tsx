import { StyleSheet, View } from 'react-native';
import { PidroText } from '@/components/ui/PidroText';
import { Coin } from '@/components/ui/PlayerAvatar';
import { PidroBevel, PidroColors, PidroFonts } from '@/design/tokens';

/** A medal: a gold-rimmed wood coin with its initial once earned, dim glass until then. */
export function MedalCoin({ name, earned, size }: { name: string; earned: boolean; size: number }) {
  return (
    <View style={!earned && styles.locked}>
      <Coin material={earned ? 'wood' : 'glass'} size={size} rim={3} style={styles.coin}>
        <PidroText
          maxFontSizeMultiplier={1}
          style={[
            styles.initial,
            { fontSize: Math.round(size * 0.36), lineHeight: Math.round(size * 0.48) },
            !earned && styles.lockedInitial,
          ]}>
          {name.charAt(0)}
        </PidroText>
      </Coin>
    </View>
  );
}

const styles = StyleSheet.create({
  coin: { position: 'relative' },
  initial: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    color: PidroBevel.textGold,
    textAlign: 'center',
  },
  locked: { opacity: 0.4 },
  lockedInitial: { color: PidroColors.text },
});
