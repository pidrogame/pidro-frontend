/**
 * When Classic's table sounds play (PID-335). Plain rules over the table's
 * presentation; `src/game/sounds.ts` plays them.
 */
import type { ServerBid } from '@/types/game';
import type { TableModel } from '@/game/canvas/tableModel';
import type { Frame } from '@/game/canvas/secondDealPlan';
import { isYourTurn } from '@/game/hapticTransitions';

/** Classic's reminder: 10 s into a turn of yours, then every 10 s until you act. */
export const TURN_REMINDER_MS = 10_000;
/** The shuffle starts this long before the deal, so it ends with the first packet's flight. */
export const SHUFFLE_LEAD_MS = 1_500;
/** A shuffle started this recently already leads into the deal that follows. */
export const SHUFFLE_COVERS_MS = 4_000;

/** A turn of yours with cards to act on; the hand that ended, held under its result, has none. */
const yourTurn = (model: TableModel) =>
  isYourTurn(model) && !model.dealUnseen && model.yourHand.length > 0;
const isYourPlayTurn = (model: TableModel) => model.phase === 'playing' && yourTurn(model);

/** "Your turn" sounds when a turn to play a card becomes yours; bidding stays silent. */
export function yourPlayTurnStarted(previous: TableModel | null, next: TableModel): boolean {
  return !!previous && isYourPlayTurn(next) && !isYourPlayTurn(previous);
}

/** One turn of yours, any phase; a new key starts the reminder over. Null when it is not yours. */
export function yourTurnKey(model: TableModel): string | null {
  return yourTurn(model) ? model.phase : null;
}

/** The newest bid or pass to show on a seat. Bulk catch-up plays the last one once. */
export function bidSound(
  previous: ServerBid[] | null | undefined,
  next: ServerBid[] | null | undefined
): 'bid' | 'pass' | null {
  if (!next || next.length <= (previous?.length ?? 0)) return null;
  return next[next.length - 1].amount === 'pass' ? 'pass' : 'bid';
}

/**
 * Exactly one card left a hand. A card is known by its face, not its key: the
 * server renames your tapped card when it confirms it. More at once is a
 * reconnect catching up: silent.
 */
export function cardPlayed(
  previous: TableModel['playedCards'],
  next: TableModel['playedCards']
): boolean {
  const seen = new Set(
    Object.values(previous)
      .flat()
      .map((card) => card?.textureKey)
  );
  const fresh = Object.values(next)
    .flat()
    .filter((card) => card && !seen.has(card.textureKey));
  return fresh.length === 1;
}

/** A player's refill arrives, once per player, the dealer's when they take the rest. */
export function refillArrives(previous: Frame, next: Frame): boolean {
  const given = (frame: Frame) => Object.values(frame.drawn).reduce((a, n) => a + (n ?? 0), 0);
  const firstCard = Object.entries(next.drawn).some(
    ([rel, n]) => (n ?? 0) > 0 && !previous.drawn[rel as keyof Frame['drawn']]
  );
  const dealerTakesRest = previous.pack > 0 && next.pack === 0 && given(next) === given(previous);
  return firstCard || dealerTakesRest;
}

/** When to start the shuffle, `dealsInMs` before the deal, never before `notBeforeMs`. */
export function shuffleAtMs(dealsInMs: number, notBeforeMs = 0): number {
  return Math.max(0, notBeforeMs, dealsInMs - SHUFFLE_LEAD_MS);
}

export function shuffleCovered(lastShuffleAt: number, now: number): boolean {
  return now - lastShuffleAt < SHUFFLE_COVERS_MS;
}

/** From the viewer's side; spectators and a tie hear nothing. */
export function gameOverSound({
  spectator,
  tied,
  won,
}: {
  spectator: boolean;
  tied: boolean;
  won: boolean;
}): 'won' | 'lost' | null {
  if (spectator || tied) return null;
  return won ? 'won' : 'lost';
}
