import { expect, test } from 'bun:test';
import { sortCards, suitOrder } from '../src/utils/cards';
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

// PID-461: the trump picker shows the suits as the hand shows them before
// trump is named, then the suits the hand lacks, red and black alternating on.
const hand = (text: string): Card[] =>
  text.split(' ').map((c) => ({
    rank: ({ A: 14, K: 13, Q: 12, J: 11, T: 10 } as Record<string, number>)[c[0]] ?? Number(c[0]),
    suit: ({ s: 'spades', h: 'hearts', c: 'clubs', d: 'diamonds' } as Record<string, Suit>)[c[1]],
  }));
for (const [name, cards, order] of [
  ['all four suits', 'Kd 7s Ah Qc 9h 2c', ['spades', 'hearts', 'clubs', 'diamonds']],
  // Marcel's beta hand: no clubs, so clubs comes last.
  ['three, red majority', 'Ah Kh Jh Th Js Ts 8s Kd Qd', ['hearts', 'spades', 'diamonds', 'clubs']],
  ['three, black majority', 'As 9s Qc 4c 8d', ['spades', 'diamonds', 'clubs', 'hearts']],
  ['two of one colour', 'Kh 9h Jd 3d', ['hearts', 'diamonds', 'spades', 'clubs']],
  ['one suit', 'Ac Kc 9c', ['clubs', 'hearts', 'spades', 'diamonds']],
  // No hearts: the 5♦ is hearts' only trump, and hearts comes after the held suits.
  ['hearts only as the other five', 'Jd 5d 8c 3c', ['clubs', 'diamonds', 'spades', 'hearts']],
] as [string, string, Suit[]][]) {
  test(`the picker's suits follow the hand: ${name}`, () => {
    expect(suitOrder(hand(cards), null)).toEqual(order);
    const sorted = sortCards(hand(cards), null);
    const groups = sorted.filter((card, i) => i === 0 || card.suit !== sorted[i - 1].suit);
    expect(groups.map((card) => card.suit)).toEqual(order.slice(0, groups.length));
  });
}
