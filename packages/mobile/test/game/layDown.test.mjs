import { describe, expect, it } from 'bun:test';
import { layDown } from '../../src/features/game/layDown.ts';

const heart = (rank) => ({ rank, suit: 'hearts' });
// Two real tricks, the second a lone card worth a point: it is not laid down.
const real = [
  {
    winner: 'east',
    points: 2,
    cards: [
      { player: 'north', card: heart(14) },
      { player: 'east', card: heart(13) },
    ],
  },
  { winner: 'north', points: 1, cards: [{ player: 'north', card: heart(10) }] },
];
const playing = { phase: 'playing', hand_number: 7, tricks: real, last_hand: null };
const one = (position, card, points, two = null) => ({
  winner: position,
  points,
  two_of_trump: two,
  cards: [{ player: position, card }],
});
// The server settles straight into the next hand's bidding. The Jack and the
// Five take their points; the Two's point stays with its player.
const settledBy = (position, cards = [heart(11), heart(5), heart(2)]) => ({
  phase: 'bidding',
  hand_number: 8,
  last_hand: {
    hand_number: 7,
    settled: cards && { position, cards },
    tricks: [
      ...real,
      one(position, heart(11), 1),
      one(position, heart(5), 5),
      one(position, heart(2), 0, { position, points: 1 }),
    ].slice(0, real.length + (cards?.length ?? 3)),
  },
});

describe('a settled hand laid down', () => {
  it('names the holder at any seat, and the cards highest first as laid', () => {
    for (const position of ['north', 'east', 'west', 'south']) {
      expect(layDown(playing, settledBy(position))).toEqual({
        hand: 7,
        position,
        cards: [heart(11), heart(5), heart(2)],
        points: 6,
        two: 1,
      });
    }
  });

  it('counts only the laid cards, never a real trick of the hand', () => {
    const down = layDown(playing, settledBy('east', [heart(11), heart(5)]));
    expect(down?.cards).toEqual([heart(11), heart(5)]);
    expect(down?.points).toBe(6);
    expect(down?.two).toBe(0);
  });

  it('is nothing for a hand ended by play, or an older server', () => {
    expect(layDown(playing, settledBy('north', null))).toBeNull();
    const { settled: _, ...older } = settledBy('north').last_hand;
    expect(layDown(playing, { ...settledBy('north'), last_hand: older })).toBeNull();
  });

  it('is nothing unless the hand on the table just settled into the next', () => {
    // Opening a table already past it, or a later push of the next hand.
    expect(layDown(null, settledBy('north'))).toBeNull();
    expect(layDown(settledBy('north'), settledBy('north'))).toBeNull();
    // The game's last hand: game over, whatever its hand number says.
    expect(layDown(playing, { ...settledBy('north'), phase: 'complete' })).toBeNull();
    // Back from away: the phone last showed the hand a trick earlier, or the hand before.
    expect(layDown({ ...playing, tricks: real.slice(0, 1) }, settledBy('north'))).toBeNull();
    expect(layDown({ ...playing, hand_number: 6 }, settledBy('north'))).toBeNull();
  });
});
