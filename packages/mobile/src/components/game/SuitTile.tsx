/**
 * A suit as a card draws it (PID-466): the card art's pip on a small white
 * tile, so a spade or a club reads on navy felt as well as a heart. Drawn from
 * the pip images, never the ♠ character, which phones may set as a colour
 * emoji that ignores the text's colour. The character stays in it unseen, so
 * the line still reads "Plays A♣".
 */
import { Image, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { PidroText, type PidroTextProps } from '@/components/ui/PidroText';
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
  spaced = false,
  testID,
}: {
  suit: Suit;
  fontSize: number;
  /** A space stands before it in the line: as wide as Nunito's, and kept unseen in the text. */
  spaced?: boolean;
  testID?: string;
}) {
  const height = Math.round(fontSize);
  const pip = Math.round(fontSize * 0.75);
  return (
    <View
      testID={testID}
      style={[
        styles.tile,
        {
          height,
          width: Math.round(fontSize * 0.9),
          marginLeft: Math.max(1, fontSize * 0.08) + (spaced ? fontSize * 0.25 : 0),
        },
      ]}>
      <Image source={SUIT_IMAGES[suit]} style={{ width: pip, height: pip }} resizeMode="contain" />
      <Text style={styles.symbol}>
        {spaced ? ' ' : ''}
        {SUIT_SYMBOLS[suit]}
      </Text>
    </View>
  );
}

/**
 * A line of text with every suit in it drawn as a `SuitTile`. The words and the tiles stand
 * side by side, centred on the line, so a tile sits level with the letters on every
 * platform: a view inside a Text goes where the platform puts it, high on Android.
 * `style` sets the words; `box` the line, which `onLayout` measures.
 */
export function SuitText({
  text,
  fontSize,
  style,
  box,
  onLayout,
  ...props
}: PidroTextProps & {
  text: string;
  fontSize: number;
  box?: Pick<ViewStyle, 'minWidth' | 'paddingHorizontal'> | false | null;
}) {
  if (!SYMBOL.test(text))
    return (
      <PidroText {...props} style={[style, box]} onLayout={onLayout}>
        {text}
      </PidroText>
    );
  const parts = text.split(SYMBOL);
  return (
    <View style={[styles.line, box]} onLayout={onLayout}>
      {parts.map((part, i) => {
        const suit = SUITS.get(part);
        if (suit)
          return (
            <SuitTile
              key={i}
              suit={suit}
              fontSize={fontSize}
              spaced={parts[i - 1]?.endsWith(' ')}
            />
          );
        // A space before a tile is its margin: a line's end drops its spaces on some platforms.
        const words = SUITS.has(parts[i + 1] ?? '') ? part.trimEnd() : part;
        return words ? (
          <PidroText key={i} {...props} style={[style, styles.words]}>
            {words}
          </PidroText>
        ) : null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center' },
  words: { flexShrink: 1 },
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
