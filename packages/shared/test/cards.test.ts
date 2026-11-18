import { expect, test } from 'bun:test';
import { SUIT_ORDER, sortCards } from '../src/utils/cards';
import type { Card, Suit } from '../src/types/game';

const suits: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
const red = (suit: Suit) => suit === 'hearts' || suit === 'diamonds';

test('held suit groups alternate as far as possible, before and after every trump', () => {
  for (const trump of [null, ...suits]) {
    for (let mask = 0; mask < 16; mask++) {
      const held = suits.filter((_, i) => mask & (1 << i));
      const cards = held.flatMap((suit) => [9, 14, 3].map((rank) => ({ suit, rank })));
      const original = structuredClone(cards);
      const sorted = sortCards(cards, trump);
      expect(cards).toEqual(original);
      expect(sorted).toHaveLength(cards.length);
      const groups = sorted.filter((card, i) => i === 0 || card.suit !== sorted[i - 1].suit);
      expect(new Set(groups.map((card) => card.suit)).size).toBe(held.length);
      if (trump && held.includes(trump)) expect(groups[0].suit).toBe(trump);
      const side = groups.filter((card) => card.suit !== trump);
      const reds = side.filter((card) => red(card.suit)).length;
      const blacks = side.length - reds;
      const transitions = side.slice(1).filter((card, i) => red(card.suit) !== red(side[i].suit));
      const maximum = Math.min(side.length - 1, 2 * Math.min(reds, blacks));
      expect(transitions.length).toBe(Math.max(0, maximum));
      for (const suit of held) {
        expect(sorted.filter((card) => card.suit === suit).map((card) => card.rank)).toEqual([14, 9, 3]);
      }
    }
  }
});

test('each trump keeps its five then the off-five together in descending trump rank', () => {
  for (const trump of suits) {
    const off = suits.find((suit) => suit !== trump && red(suit) === red(trump))!;
    const cards: Card[] = [
      { suit: off, rank: 5 }, { suit: off, rank: 14 },
      ...[2, 5, 10, 1, 6, 4].map((rank) => ({ suit: trump, rank })),
    ];
    expect(sortCards(cards, trump)).toEqual([
      ...[1, 10, 6, 5].map((rank) => ({ suit: trump, rank })),
      { suit: off, rank: 5 },
      ...[4, 2].map((rank) => ({ suit: trump, rank })),
      { suit: off, rank: 14 },
    ]);
    expect(sortCards([{ suit: off, rank: 14 }, { suit: off, rank: 5 }], trump)).toEqual([
      { suit: off, rank: 5 },
      { suit: off, rank: 14 },
    ]);
  }
});

// PID-461: the trump picker shows the suits in SUIT_ORDER, so a hand of all
// four, sorted before trump is named, must run in that order too.
test('a hand of all four suits sorts in SUIT_ORDER before trump is named', () => {
  expect(SUIT_ORDER).toEqual(['spades', 'hearts', 'clubs', 'diamonds']);
  const cards: Card[] = [
    { suit: 'diamonds', rank: 5 },
    { suit: 'clubs', rank: 12 },
    { suit: 'hearts', rank: 9 },
    { suit: 'diamonds', rank: 10 },
    { suit: 'spades', rank: 7 },
    { suit: 'hearts', rank: 14 },
  ];
  const sorted = sortCards(cards, null);
  const groups = sorted.filter((card, i) => i === 0 || card.suit !== sorted[i - 1].suit);
  expect(groups.map((card) => card.suit)).toEqual(SUIT_ORDER);
});
