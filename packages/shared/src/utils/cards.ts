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

/**
 * Classic's suit order (PID-461): hearts, diamonds, spades, clubs. The hand
 * and the trump picker keep it whatever you hold; air in the hand, not
 * alternating colours, tells two reds apart.
 */
export const SUIT_ORDER: Suit[] = ['hearts', 'diamonds', 'spades', 'clubs'];

/** Trumps first, the other five among them; then the rest in SUIT_ORDER, high to low. */
export function sortCards(cards: Card[], trumpSuit: Suit | null | undefined): Card[] {
  const isTrump = (card: Card) =>
    !!trumpSuit &&
    (card.suit === trumpSuit || (card.rank === 5 && isSameColor(card.suit, trumpSuit)));
  const rank = (card: Card) =>
    card.rank === 1 ? 14 : isTrump(card) && card.rank === 5 && card.suit !== trumpSuit ? 4.5 : card.rank;
  return [...cards].sort((a, b) => {
    const aIsTrump = isTrump(a);
    const bIsTrump = isTrump(b);
    if (aIsTrump && !bIsTrump) return -1;
    if (!aIsTrump && bIsTrump) return 1;
    if (aIsTrump && bIsTrump) return rank(b) - rank(a);

    const aSuitIndex = SUIT_ORDER.indexOf(a.suit);
    const bSuitIndex = SUIT_ORDER.indexOf(b.suit);
    if (aSuitIndex !== bSuitIndex) return aSuitIndex - bSuitIndex;

    return rank(b) - rank(a);
  });
}
