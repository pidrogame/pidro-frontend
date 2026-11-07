/**
 * A settled hand (PID-366): once one player alone holds trumps, the server
 * ends the hand in one revision, straight from play to the next hand, and
 * says whose cards were laid down. This only reads that change; the server
 * decides the hand is settled, and what the cards took, in the one-card
 * tricks it keeps for them.
 */
import type { Card, ServerGameState } from '@/types/game';
import type { Position } from '@/types/lobby';

export type LayDown = {
  hand: number;
  position: Position;
  /** Highest first, the order laid. */
  cards: Card[];
  /** What their tricks took, as the hand log counts them: the tricks' points, and the 2 of trump's. */
  points: number;
  two: number;
};

type State = Pick<ServerGameState, 'phase' | 'hand_number' | 'tricks' | 'last_hand'>;

const same = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;

/**
 * A lay-down: the hand in play just settled and the next one began. Nothing
 * for a hand ended by play, an older server, or the last hand of a game.
 */
export function layDown(previous: State | null, next: State | null): LayDown | null {
  const hand = next?.last_hand;
  const settled = hand?.settled;
  if (!hand || !settled?.cards.length || previous?.phase !== 'playing') return null;
  if (next?.phase === 'complete' || next?.phase === 'game_over') return null;
  if ((next?.hand_number ?? 0) <= hand.hand_number) return null;
  // The table this phone showed as the hand settled, not one it fell behind on while away.
  const before = (previous.tricks ?? []).length + settled.cards.length;
  if (hand.hand_number !== previous.hand_number || before !== hand.tricks?.length) return null;
  const tricks = (hand.tricks ?? []).filter(
    (trick) =>
      trick.cards.length === 1 && settled.cards.some((card) => same(card, trick.cards[0].card))
  );
  return {
    hand: hand.hand_number,
    position: settled.position,
    cards: settled.cards,
    points: tricks.reduce((sum, trick) => sum + (trick.points ?? 0), 0),
    two: tricks.reduce((sum, trick) => sum + (trick.two_of_trump?.points ?? 0), 0),
  };
}
