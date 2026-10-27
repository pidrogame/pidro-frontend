/**
 * Cross-platform Skia card textures. Native loads the bundled require() modules
 * (same art as src/utils/cardImages.ts); web loads the public/cards mirror because
 * Metro-web require() doesn't resolve to a URL for Skia. All 52 faces + back +
 * 4 suit glyphs are decoded once for the whole app, starting as early as the
 * waiting room (`preloadCardTextures`); a missing texture renders as a fallback
 * frame.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { loadData, Skia, type SkImage } from '@shopify/react-native-skia';
import { getCardImage } from '@/utils/cardImages';
import type { Card, Suit } from '@/types/game';
import { cardKey, type CardKey } from './cardKey';

export { cardKey, type CardKey } from './cardKey';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

// Fixed order → stable hook call order for the useImage loop below.
const ALL_CARDS: Card[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));

type ImgSource = string | number;

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
  get: (key: CardKey) => SkImage | null;
  back: SkImage | null;
  suit: (suit: Suit) => SkImage | null;
  ready: boolean;
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
      get: (k) => image(k),
      back: image('back'),
      suit: (s) => image(s),
      ready: image('back') != null && ALL_CARDS.every((card) => image(cardKey(card)) != null),
      loading: loading != null,
      loaded: settled / SOURCES.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [told]);
}
