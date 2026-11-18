/**
 * Cross-platform Skia card textures. Native loads the bundled require() modules
 * (same art as src/utils/cardImages.ts); web loads today's faces from the
 * public/cards mirror, and the larger set (PID-467) through require(), which
 * Expo's web asset transform now gives Skia as `{ uri }`. All 52 faces + back +
 * 4 suit glyphs are decoded once for the whole app, starting as early as the
 * waiting room (`preloadCardTextures`); a missing texture renders as a fallback
 * frame.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Dimensions, PixelRatio, Platform, type ImageSourcePropType } from 'react-native';
import { loadData, Skia, type SkImage } from '@shopify/react-native-skia';
import { getCardImage } from '@/utils/cardImages';
import type { Card, Suit } from '@/types/game';
import { cardKey, type CardKey } from './cardKey';
import { cardSize, handScale, pickProfile } from './layout';

export { cardKey, type CardKey } from './cardKey';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

// Fixed order → stable hook call order for the useImage loop below.
const ALL_CARDS: Card[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));

type ImgSource = string | ImageSourcePropType;

/** Today's face art is 168px wide; `cards-2x` is the same art at 336px (PID-467). */
const FACE_PX = 168;

/**
 * Which face art a screen loads (PID-467): where your hand's card, upright or
 * on its side, is wider in device pixels than today's art, the larger set as
 * well as today's; otherwise today's alone, at today's texture memory.
 */
export function largeFaces(width: number, height: number, pixelRatio: number): boolean {
  const hand = (w: number, h: number) => cardSize(w, h) * handScale(pickProfile(w, h));
  return Math.max(hand(width, height), hand(height, width)) * pixelRatio > FACE_PX;
}

/**
 * How a face is drawn (PID-467), from the size in device pixels it rests at,
 * at its largest: your cards by your hand's, the others' by the trick's. So a
 * card keeps one look through every flight and pile. The larger art from
 * 168px up, Catmull-Rom from about 0.8 of it, Mitchell below (measured on the
 * table's sizes); `null` is today's art, drawn as before.
 */
export function largeFaceSampling(loaded: boolean, restPx: number) {
  if (!loaded || restPx < FACE_PX) return null;
  return restPx >= FACE_PX * 2 * 0.8 ? CATMULL_ROM : MITCHELL;
}
const CATMULL_ROM = { B: 0, C: 0.5 };
const MITCHELL = { B: 1 / 3, C: 1 / 3 };

const screen = Dimensions.get('screen');
const LARGE = largeFaces(screen.width, screen.height, PixelRatio.get());

/** A face drawn beside the canvas (laid down, thrown), in the art the canvas draws it in. */
export function faceImage(card: Card, restPx: number): ImageSourcePropType {
  return largeFaceSampling(LARGE, restPx) ? LARGE_FACES[cardKey(card)] : getCardImage(card);
}

// prettier-ignore
const LARGE_FACES: Record<CardKey, ImageSourcePropType> = {
  spades_2: require('~/assets/images/cards-2x/spades_2.png'),
  spades_3: require('~/assets/images/cards-2x/spades_3.png'),
  spades_4: require('~/assets/images/cards-2x/spades_4.png'),
  spades_5: require('~/assets/images/cards-2x/spades_5.png'),
  spades_6: require('~/assets/images/cards-2x/spades_6.png'),
  spades_7: require('~/assets/images/cards-2x/spades_7.png'),
  spades_8: require('~/assets/images/cards-2x/spades_8.png'),
  spades_9: require('~/assets/images/cards-2x/spades_9.png'),
  spades_10: require('~/assets/images/cards-2x/spades_10.png'),
  spades_11: require('~/assets/images/cards-2x/spades_11.png'),
  spades_12: require('~/assets/images/cards-2x/spades_12.png'),
  spades_13: require('~/assets/images/cards-2x/spades_13.png'),
  spades_14: require('~/assets/images/cards-2x/spades_14.png'),
  hearts_2: require('~/assets/images/cards-2x/hearts_2.png'),
  hearts_3: require('~/assets/images/cards-2x/hearts_3.png'),
  hearts_4: require('~/assets/images/cards-2x/hearts_4.png'),
  hearts_5: require('~/assets/images/cards-2x/hearts_5.png'),
  hearts_6: require('~/assets/images/cards-2x/hearts_6.png'),
  hearts_7: require('~/assets/images/cards-2x/hearts_7.png'),
  hearts_8: require('~/assets/images/cards-2x/hearts_8.png'),
  hearts_9: require('~/assets/images/cards-2x/hearts_9.png'),
  hearts_10: require('~/assets/images/cards-2x/hearts_10.png'),
  hearts_11: require('~/assets/images/cards-2x/hearts_11.png'),
  hearts_12: require('~/assets/images/cards-2x/hearts_12.png'),
  hearts_13: require('~/assets/images/cards-2x/hearts_13.png'),
  hearts_14: require('~/assets/images/cards-2x/hearts_14.png'),
  diamonds_2: require('~/assets/images/cards-2x/diamonds_2.png'),
  diamonds_3: require('~/assets/images/cards-2x/diamonds_3.png'),
  diamonds_4: require('~/assets/images/cards-2x/diamonds_4.png'),
  diamonds_5: require('~/assets/images/cards-2x/diamonds_5.png'),
  diamonds_6: require('~/assets/images/cards-2x/diamonds_6.png'),
  diamonds_7: require('~/assets/images/cards-2x/diamonds_7.png'),
  diamonds_8: require('~/assets/images/cards-2x/diamonds_8.png'),
  diamonds_9: require('~/assets/images/cards-2x/diamonds_9.png'),
  diamonds_10: require('~/assets/images/cards-2x/diamonds_10.png'),
  diamonds_11: require('~/assets/images/cards-2x/diamonds_11.png'),
  diamonds_12: require('~/assets/images/cards-2x/diamonds_12.png'),
  diamonds_13: require('~/assets/images/cards-2x/diamonds_13.png'),
  diamonds_14: require('~/assets/images/cards-2x/diamonds_14.png'),
  clubs_2: require('~/assets/images/cards-2x/clubs_2.png'),
  clubs_3: require('~/assets/images/cards-2x/clubs_3.png'),
  clubs_4: require('~/assets/images/cards-2x/clubs_4.png'),
  clubs_5: require('~/assets/images/cards-2x/clubs_5.png'),
  clubs_6: require('~/assets/images/cards-2x/clubs_6.png'),
  clubs_7: require('~/assets/images/cards-2x/clubs_7.png'),
  clubs_8: require('~/assets/images/cards-2x/clubs_8.png'),
  clubs_9: require('~/assets/images/cards-2x/clubs_9.png'),
  clubs_10: require('~/assets/images/cards-2x/clubs_10.png'),
  clubs_11: require('~/assets/images/cards-2x/clubs_11.png'),
  clubs_12: require('~/assets/images/cards-2x/clubs_12.png'),
  clubs_13: require('~/assets/images/cards-2x/clubs_13.png'),
  clubs_14: require('~/assets/images/cards-2x/clubs_14.png'),
};

function faceSource(card: Card): ImgSource {
  return Platform.OS === 'web'
    ? `/cards/${card.suit}_${card.rank}.png`
    : (getCardImage(card) as number);
}

const BACK_SOURCE: ImgSource =
  Platform.OS === 'web'
    ? '/cards/cardback.png'
    : (require('~/assets/images/cardback.png') as number);

// Suit value (plural) → glyph file (singular).
const SUIT_FILE: Record<Suit, string> = {
  hearts: 'heart',
  diamonds: 'diamond',
  clubs: 'club',
  spades: 'spade',
};
const SUIT_NATIVE: Record<Suit, number> = {
  hearts: require('~/assets/images/heart.png'),
  diamonds: require('~/assets/images/diamond.png'),
  clubs: require('~/assets/images/club.png'),
  spades: require('~/assets/images/spade.png'),
};
function suitSource(suit: Suit): ImgSource {
  return Platform.OS === 'web' ? `/cards/${SUIT_FILE[suit]}.png` : SUIT_NATIVE[suit];
}

export type CardTextures = {
  /** Today's face, or with `large` the 336px one (only where `large` loaded). */
  get: (key: CardKey, large?: boolean) => SkImage | null;
  back: SkImage | null;
  suit: (suit: Suit) => SkImage | null;
  ready: boolean;
  /** The 336px faces are loaded too (PID-467). */
  large: boolean;
  /** Still decoding: the table shows how far. */
  loading: boolean;
  /** Share of the textures decoded so far, 0 to 1. */
  loaded: number;
};

type ImgSourceParam = Parameters<typeof loadData>[0];
const SOURCES: [string, ImgSource][] = [
  ...ALL_CARDS.map((card): [string, ImgSource] => [cardKey(card), faceSource(card)]),
  ...SUITS.map((suit): [string, ImgSource] => [suit, suitSource(suit)]),
  ['back', BACK_SOURCE],
  ...(LARGE
    ? ALL_CARDS.map((card): [string, ImgSource] => [
        `${cardKey(card)}@2x`,
        LARGE_FACES[cardKey(card)],
      ])
    : []),
];
// Decoded textures. A failed one is left out, so its card draws the fallback
// frame and the next table tries it again.
const images = new Map<string, SkImage>();
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
let settled = 0;
let notifying: ReturnType<typeof setTimeout> | null = null;
// What the table has been told: it changes only when it is told.
let version = 0;

function notify() {
  version++;
  listeners.forEach((listener) => listener());
}

/** Tells the table at most every 100ms: a decode each is a re-render each. */
function settle(key: string, image: SkImage | null) {
  settled++;
  if (image) images.set(key, image);
  notifying ??= setTimeout(() => {
    notifying = null;
    notify();
  }, NOTIFY_MS);
}
const NOTIFY_MS = 100;

/** Pixels now, in the waiting room, not on the first frame that draws the card. */
function decoded(image: SkImage | null) {
  try {
    return image?.makeNonTextureImage() ?? image;
  } catch {
    return image;
  }
}

/** Decodes every texture once; later calls share the same work. */
export function preloadCardTextures(): Promise<void> {
  if (loading || images.size === SOURCES.length) return loading ?? Promise.resolve();
  settled = images.size;
  loading = Promise.all(
    SOURCES.filter(([key]) => !images.has(key)).map(([key, source]) =>
      loadData(source as ImgSourceParam, (data) => decoded(Skia.Image.MakeImageFromEncoded(data)))
        .catch(() => null)
        .then((image) => settle(key, image))
    )
  ).then(() => {
    loading = null;
    notify();
  });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCardTextures(): CardTextures {
  const told = useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    void preloadCardTextures();
  }, []);
  // `told` changes whenever `images` does: a new object, so the table redraws.
  return useMemo(() => {
    const image = (key: string) => images.get(key) ?? null;
    return {
      get: (k, large) => image(large ? `${k}@2x` : k),
      back: image('back'),
      suit: (s) => image(s),
      ready: image('back') != null && ALL_CARDS.every((card) => image(cardKey(card)) != null),
      large: LARGE,
      loading: loading != null,
      loaded: settled / SOURCES.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [told]);
}
