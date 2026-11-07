import type { Card, ServerGameState, ServerTrickPlay } from '@/types/game';
import type { Position } from '@/types/lobby';

const same = (a: Card) => (b: Card) => a.rank === b.rank && a.suit === b.suit;

function playedBy(state: ServerGameState, position: Position): Card[] {
  const trick = state.current_trick as unknown;
  const current = Array.isArray(trick)
    ? trick
    : ((trick as { plays?: ServerTrickPlay[] } | null)?.plays ?? []);
  return [...(state.tricks ?? []).flatMap((done) => done.cards), ...current]
    .filter((play: ServerTrickPlay) => play?.player === position)
    .map((play) => play.card);
}

/**
 * What the table played from your hand while you were away (PID-364): the
 * timer or the bot that kept your seat. Cards your own taps sent, and cards a
 * "Time ran out" notice already named, are not news. Only within one hand of
 * one game; a new hand has nothing to compare with.
 */
export function awayPlays(
  before: ServerGameState,
  after: ServerGameState,
  position: Position,
  { tapped, told }: { tapped: Card[]; told: Card[] }
): { cards: Card[]; out: boolean } | null {
  const held = before.players?.[position]?.hand;
  if (
    !Array.isArray(held) ||
    before.phase !== 'playing' ||
    after.phase !== 'playing' ||
    after.game_instance_id !== before.game_instance_id ||
    after.hand_number !== before.hand_number
  )
    return null;
  const played = playedBy(after, position);
  const cards = held.filter(
    (card) => played.some(same(card)) && !tapped.some(same(card)) && !told.some(same(card))
  );
  return cards.length ? { cards, out: !!after.players?.[position]?.eliminated } : null;
}
