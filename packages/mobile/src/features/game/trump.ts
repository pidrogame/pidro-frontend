/**
 * Picking trump (PID-209): what each suit would leave you holding. The rule is
 * the engine's (`isTrumpCard`): a suit's own cards and the same-colour five.
 */
import type { Card, Suit } from '@/types/game';
import { isTrumpCard } from '@/utils/cards';

/** The cards that would be trump if `suit` were named. */
export function trumpsIn(hand: Card[], suit: Suit): Card[] {
  return hand.filter((card) => isTrumpCard(card, suit));
}
