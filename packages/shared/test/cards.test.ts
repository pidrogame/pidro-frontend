import { expect, test } from 'bun:test';
import { SUIT_ORDER, sortCards } from '../src/utils/cards';
import type { Card, Suit } from '../src/types/game';

const suits: Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
const red = (suit: Suit) => suit === 'hearts' || suit === 'diamonds';

// PID-461: Classic's fixed order, whatever the hand holds and whatever is trump.
test('side suits keep hearts, diamonds, spades, clubs, after every trump', () => {
  expect(SUIT_ORDER).toEqual(['hearts', 'diamonds', 'spades', 'clubs']);
  for (const trump of [null, ...suits]) {
    for (let mask = 0; mask < 16; mask++) {
      const held = suits.filter((_, i) => mask & (1 << i));
      // No fives, so a suit's cards are trump only when it is trump.
      const cards = held.flatMap((suit) => [9, 14, 3].map((rank) => ({ suit, rank })));
      const original = structuredClone(cards);
      const sorted = sortCards(cards, trump);
      expect(cards).toEqual(original);
      const groups = sorted
        .filter((card, i) => i === 0 || card.suit !== sorted[i - 1].suit)
        .map((card) => card.suit);
      const side = SUIT_ORDER.filter((suit) => held.includes(suit) && suit !== trump);
      expect(groups).toEqual(trump && held.includes(trump) ? [trump, ...side] : side);
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

// PID-461: Marcel's sheets, before trump is named, and a hand after it.
const hand = (text: string): Card[] =>
  text.split(' ').map((c) => ({
    rank: ({ A: 14, K: 13, Q: 12, J: 11, T: 10 } as Record<string, number>)[c[0]] ?? Number(c[0]),
    suit: ({ s: 'spades', h: 'hearts', c: 'clubs', d: 'diamonds' } as Record<string, Suit>)[c[1]],
  }));
for (const [name, cards, trump, sorted] of [
  ['your hand, no clubs', 'Js Kd Th Ah 8s Qd Jh Ts Kh', null, 'Ah Kh Jh Th Kd Qd Js Ts 8s'],
  ['all four suits', '2c 9s 5h Jd 8c 6h 2s 2d 9d', null, '6h 5h Jd 9d 2d 9s 2s 8c 2c'],
  ['no hearts', '5c 6d Ad 2c Qd 7d 6s 4d 5s', null, 'Ad Qd 7d 6d 4d 6s 5s 5c 2c'],
  // Hearts named: its trumps, the 5♦ among them, then spades and clubs.
  ['after trump', 'Kc 5d 2s Ah 3h Qs 9c Th 4c', 'hearts', 'Ah Th 5d 3h Qs 2s Kc 9c 4c'],
] as [string, string, Suit | null, string][]) {
  test(`sorts in Classic's order: ${name}`, () => {
    expect(sortCards(hand(cards), trump)).toEqual(hand(sorted));
  });
}
