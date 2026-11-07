import { expect, it } from 'bun:test';
import { awayPlays } from '../../src/features/game/awayPlays.ts';

const spade = (rank) => ({ rank, suit: 'spades' });
const heart = (rank) => ({ rank, suit: 'hearts' });
const club = (rank) => ({ rank, suit: 'clubs' });
// Dawg's table: South holds 10♠ 5♥ and 4♣ with spades trump, and it is South's turn.
const before = {
  game_instance_id: 'game',
  hand_number: 3,
  phase: 'playing',
  current_player: 'south',
  tricks: [{ cards: [{ player: 'south', card: spade(14) }], winner: 'south' }],
  current_trick: [{ player: 'west', card: spade(3) }],
  players: { south: { hand: [spade(10), heart(5), club(4)] } },
};
const played = (cards, south = {}) => ({
  ...before,
  tricks: [
    ...before.tricks,
    {
      cards: [
        { player: 'west', card: spade(3) },
        ...cards.map((card) => ({ player: 'south', card })),
      ],
      winner: 'west',
    },
  ],
  current_trick: [],
  players: { south: { hand: [], ...south } },
});
const none = { tapped: [], told: [] };

it('names the card the table played for you while you were away', () => {
  const after = played([spade(10)], { hand: [heart(5), club(4)] });
  expect(awayPlays(before, after, 'south', none)).toEqual({ cards: [spade(10)], out: false });
});

it('names two cards, one in a trick and one on the table now', () => {
  const after = {
    ...played([spade(10)]),
    current_trick: { plays: [{ player: 'south', card: heart(5) }] },
    players: { south: { hand: [club(4)] } },
  };
  expect(awayPlays(before, after, 'south', none)?.cards).toEqual([spade(10), heart(5)]);
});

it('says you are out, and never counts the folded cards as played', () => {
  const after = played([spade(10)], {
    hand: [],
    eliminated: true,
    revealed_cards: [heart(5), club(4)],
  });
  expect(awayPlays(before, after, 'south', none)).toEqual({ cards: [spade(10)], out: true });
});

it('says nothing when your own tap or a "Time ran out" notice took the card', () => {
  const after = played([spade(10)], { hand: [heart(5), club(4)] });
  expect(awayPlays(before, after, 'south', { tapped: [spade(10)], told: [] })).toBeNull();
  expect(awayPlays(before, after, 'south', { tapped: [], told: [spade(10)] })).toBeNull();
});

it('says nothing when nothing of yours was played, or across hands and games', () => {
  expect(awayPlays(before, before, 'south', none)).toBeNull();
  // Another seat's card is not yours, even one you also hold the rank of.
  expect(
    awayPlays(
      before,
      { ...before, current_trick: [{ player: 'west', card: club(4) }] },
      'south',
      none
    )
  ).toBeNull();
  const after = played([spade(10)]);
  expect(awayPlays(before, { ...after, hand_number: 4 }, 'south', none)).toBeNull();
  expect(awayPlays(before, { ...after, game_instance_id: 'rematch' }, 'south', none)).toBeNull();
  expect(awayPlays({ ...before, phase: 'second_deal' }, after, 'south', none)).toBeNull();
});
