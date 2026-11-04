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

/** The cards the table has heard: those on the felt, and those of this trick that went back to a hand. */
export type CardsHeard = { trick: number; faces: ReadonlySet<string> };
type Played = Pick<TableModel, 'playedCards' | 'lastTrick'>;

const faces = (model: Played) =>
  Object.values(model.playedCards).flatMap((cards) => (cards ?? []).map((card) => card.textureKey));

/** A tap confirmed after its timeout went back to the hand: this trick still remembers it (PID-344). */
export function cardsHeard(model: Played, heard?: CardsHeard): CardsHeard {
  const trick = model.lastTrick?.number ?? 0;
  const kept = heard?.trick === trick ? heard.faces : [];
  return { trick, faces: new Set([...kept, ...faces(model)]) };
}

/**
 * Exactly one card left a hand, once per card. A card is known by its face,
 * not its key: the server renames your tapped card when it confirms it. More
 * at once is a reconnect catching up: silent.
 */
export function cardPlayed(heard: CardsHeard, next: Played): boolean {
  return faces(next).filter((face) => !heard.faces.has(face)).length === 1;
}

/** The cut's sounds belong to its cards, not to where a rotation lays them (PID-344). */
export function cutSoundKey(cuts: TableModel['dealerCuts']): string | null {
  const keys = Object.values(cuts).flatMap((card) => (card ? [card.key] : []));
  return keys.length ? keys.sort().join('|') : null;
}

/** Web starts audio only after a tap or key on the page; until then a sound is dropped. */
export function pageMayPlay(
  userActivation: { hasBeenActive: boolean } | undefined,
  gestured: boolean
): boolean {
  return userActivation?.hasBeenActive ?? gestured;
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
