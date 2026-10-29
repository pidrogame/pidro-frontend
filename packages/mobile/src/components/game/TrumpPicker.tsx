/**
 * Picking trump in the felt (PID-209): four suit buttons in the trick circle,
 * so the hand you choose from stays in view. Pointing at a suit (hover, or a
 * finger still down) lifts the cards it would make trump; one tap declares it.
 */
import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { PidroColors, PidroRadii } from '@/design/tokens';
import { TRUMP_SUITS, trumpsIn } from '@/features/game/trump';
import { TRUMP_BUTTON, type trumpPicker } from '@/game/canvas/layout';
import type { Card, Suit } from '@/types/game';
import { useTranslation } from '@/i18n';
import { actionTap, pushAttempt } from '@/diagnostics/actions';

const SUIT_IMAGES = {
  hearts: require('~/assets/images/heart.png'),
  diamonds: require('~/assets/images/diamond.png'),
  clubs: require('~/assets/images/club.png'),
  spades: require('~/assets/images/spade.png'),
};

type Props = {
  cards: Card[];
  frame: ReturnType<typeof trumpPicker>;
  /** The suit the hand shows lifted. */
  preview: Suit | null;
  /** A suit pointed at, or null when the pointer leaves. */
  onPoint: (suit: Suit | null) => void;
  onSelect: (suit: Suit) => Promise<void> | void;
};

export function TrumpPicker({ cards, frame, preview, onPoint, onSelect }: Props) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<Suit | null>(null);
  useEffect(() => () => onPoint(null), [onPoint]);

  const point = (suit: Suit | null) => {
    if (!chosen) onPoint(suit);
  };
  const choose = async (suit: Suit) => {
    if (chosen) {
      pushAttempt('declare_trump').record('blocked', 'pending');
      return;
    }
    setChosen(suit);
    onPoint(suit);
    try {
      await onSelect(suit);
    } finally {
      setChosen(null);
    }
  };

  return (
    <View
      testID="trump-picker"
      pointerEvents="box-none"
      style={[
        styles.picker,
        { left: frame.left, top: frame.top, width: frame.width, height: frame.height },
      ]}>
      {frame.caption ? (
        <PidroText role="label" tone="soft" align="center" maxFontSizeMultiplier={1.2}>
          {t('game.choose_trump')}
        </PidroText>
      ) : null}
      <View style={[styles.grid, { gap: frame.gap }]}>
        {TRUMP_SUITS.map((suit) => {
          const name = t(`game.${suit}`);
          const count = t('game.trumps', { count: trumpsIn(cards, suit).length });
          const active = (chosen ?? preview) === suit;
          return (
            <PressableFX
              key={suit}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${count}`}
              accessibilityState={{ selected: chosen === suit, disabled: !!chosen }}
              disabled={!!chosen}
              onHoverIn={() => point(suit)}
              onHoverOut={() => point(null)}
              onPressIn={() => point(suit)}
              onPressOut={() => point(null)}
              onPress={() => actionTap('declare_trump', () => choose(suit))}
              style={[
                styles.suit,
                { height: frame.buttonHeight },
                active && styles.active,
                chosen === suit && styles.chosen,
                chosen && chosen !== suit && styles.waiting,
              ]}
              pressedStyle={styles.chosen}>
              <Image
                source={SUIT_IMAGES[suit]}
                style={[styles.glyph, frame.buttonHeight < TRUMP_BUTTON.height && styles.short]}
                resizeMode="contain"
              />
              <PidroText role="label" align="center" numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {name}
              </PidroText>
              <PidroText
                role="metadata"
                tone={active ? 'gold' : 'soft'}
                align="center"
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}>
                {chosen === suit ? t('game.declaring') : count}
              </PidroText>
            </PressableFX>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: {
    position: 'absolute',
    zIndex: 56,
    alignItems: 'center',
    gap: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  suit: {
    width: TRUMP_BUTTON.width,
    height: TRUMP_BUTTON.height,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PidroRadii.panel,
    borderWidth: 1.5,
    borderColor: PidroColors.cyanBorder,
    backgroundColor: PidroColors.trickChipBg,
  },
  active: {
    borderColor: PidroColors.gold,
  },
  chosen: {
    borderColor: PidroColors.gold,
    backgroundColor: PidroColors.chosenBg,
  },
  waiting: {
    opacity: 0.48,
  },
  glyph: {
    width: 32,
    height: 32,
    marginBottom: 2,
  },
  short: { width: 24, height: 24 },
});
