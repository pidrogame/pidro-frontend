import type { Card, Suit } from '../types/game';

export const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

export const SUIT_COLORS_RAW: Record<Suit, string> = {
  hearts: '#e11d48',
  diamonds: '#e11d48',
  clubs: '#1e293b',
  spades: '#1e293b',
};

export const SUIT_BADGE_COLORS: Record<Suit, string> = {
  hearts: '#fff1f2',
  diamonds: '#fff1f2',
  clubs: '#f1f5f9',
  spades: '#f1f5f9',
};

export function getRankLabel(rank: number) {
  if (rank === 1 || rank === 14) return 'A';
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  return `${rank}`;
}

export function formatSuitLabel(suit: Suit) {
  return suit.charAt(0).toUpperCase() + suit.slice(1);
}

/** Point value for a scoring card in the active trump suit. */
export function getPidroPoints(rank: number, suit: Suit, trumpSuit?: Suit | null): number | null {
  if (!trumpSuit) return null;

  const isTrump = suit === trumpSuit;
  const isOffFive = rank === 5 && !isTrump && isSameColor(suit, trumpSuit);
  if (!isTrump && !isOffFive) return null;

  if (rank === 5) return 5;
  if (rank === 1 || rank === 14 || rank === 2 || rank === 10 || rank === 11) return 1;
  return null;
}

function isSameColor(a: Suit, b: Suit): boolean {
  const aIsRed = a === 'hearts' || a === 'diamonds';
  const bIsRed = b === 'hearts' || b === 'diamonds';
  return aIsRed === bIsRed;
}

/** The suits as a hand is sorted before trump is named. */
export const SUIT_ORDER: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];

export function sortCards(cards: Card[], trumpSuit: Suit | null | undefined): Card[] {
  const isTrump = (card: Card) =>
    !!trumpSuit &&
    (card.suit === trumpSuit || (card.rank === 5 && isSameColor(card.suit, trumpSuit)));
  const sideSuits = SUIT_ORDER.filter((suit) =>
    cards.some((card) => card.suit === suit && !isTrump(card))
  );
  const black = sideSuits.filter((suit) => isSameColor(suit, 'spades'));
  const red = sideSuits.filter((suit) => isSameColor(suit, 'hearts'));
  // Start with the majority color, so a lone opposite suit separates its pair.
  // Ties continue the alternation from trump, if the hand holds any.
  let useRed =
    red.length > black.length ||
    (red.length === black.length && !!trumpSuit && cards.some(isTrump) &&
      isSameColor(trumpSuit, 'spades'));
  const order: Suit[] = [];
  while (black.length || red.length) {
    const next = (useRed ? red : black).shift() ?? (useRed ? black : red).shift();
    if (next) order.push(next);
    useRed = !useRed;
  }
  const rank = (card: Card) =>
    card.rank === 1 ? 14 : isTrump(card) && card.rank === 5 && card.suit !== trumpSuit ? 4.5 : card.rank;
  return [...cards].sort((a, b) => {
    const aIsTrump = isTrump(a);
    const bIsTrump = isTrump(b);
    if (aIsTrump && !bIsTrump) return -1;
    if (!aIsTrump && bIsTrump) return 1;
    if (aIsTrump && bIsTrump) return rank(b) - rank(a);

    const aSuitIndex = order.indexOf(a.suit);
    const bSuitIndex = order.indexOf(b.suit);
    if (aSuitIndex !== bSuitIndex) return aSuitIndex - bSuitIndex;

    return rank(b) - rank(a);
  });
}
