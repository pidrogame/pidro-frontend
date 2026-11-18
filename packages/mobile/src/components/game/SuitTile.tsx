/**
 * A suit as a card draws it (PID-466): the card art's pip on a small white
 * tile, so a spade or a club reads on navy felt as well as a heart. Drawn from
 * the pip images, never the ♠ character, which phones may set as a colour
 * emoji that ignores the text's colour. It sits inline in a line of text; the
 * character stays there unseen, so the line still reads "Plays A♣".
 */
import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { PidroColors } from '@/design/tokens';
import type { Suit } from '@/types/game';
import { SUIT_SYMBOLS } from '@/utils/cards';

export const SUIT_IMAGES = {
  hearts: require('~/assets/images/heart.png'),
  diamonds: require('~/assets/images/diamond.png'),
  clubs: require('~/assets/images/club.png'),
  spades: require('~/assets/images/spade.png'),
};

const SUITS = new Map(Object.entries(SUIT_SYMBOLS).map(([suit, symbol]) => [symbol, suit as Suit]));
const SYMBOL = new RegExp(`([${Object.values(SUIT_SYMBOLS).join('')}])`);

/** A tile as tall as the type is set, for text at `fontSize`. */
export function SuitTile({
  suit,
  fontSize,
  testID,
}: {
  suit: Suit;
  fontSize: number;
  testID?: string;
}) {
  const height = Math.round(fontSize);
  const pip = Math.round(fontSize * 0.75);
  return (
    <View
      testID={testID}
      style={[
        styles.tile,
        { height, width: Math.round(fontSize * 0.9), marginLeft: Math.max(1, fontSize * 0.08) },
      ]}>
      <Image source={SUIT_IMAGES[suit]} style={{ width: pip, height: pip }} resizeMode="contain" />
      <Text style={styles.symbol}>{SUIT_SYMBOLS[suit]}</Text>
    </View>
  );
}

/** `text` with every suit in it drawn as a `SuitTile`, to put inside a `Text`. */
export function withSuits(text: string, fontSize: number): ReactNode {
  if (!SYMBOL.test(text)) return text;
  return text
    .split(SYMBOL)
    .map((part, i) =>
      SUITS.has(part) ? <SuitTile key={i} suit={SUITS.get(part)!} fontSize={fontSize} /> : part
    );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PidroColors.leagueCardEdge,
    backgroundColor: PidroColors.leagueCardFace,
  },
  symbol: {
    position: 'absolute',
    opacity: 0,
    fontSize: 1,
  },
});
