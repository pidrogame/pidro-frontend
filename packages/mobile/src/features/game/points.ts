/**
 * Whose points they were (PID-230): every point a trick scores, a Pidro's
 * five most of all, reads as ours or theirs. The server says who took what;
 * this only reads it from the viewer's seat.
 */
import type { Position } from '@/types/lobby';
import type { RelativePosition } from '@/types/game';

/** A trick worth this much holds a five: the big moment. */
export const PIDRO_POINTS = 5;

/** A spectator has no side: neither happy nor sad. */
export type PointsSide = 'ours' | 'theirs' | 'neutral';

const northSouth = (position: Position) => position === 'north' || position === 'south';

/**
 * Ours when the scorer sits on the viewer's team (the viewer or their partner),
 * theirs otherwise. `column` is the score plaque's column it lands in: for a
 * spectator, N/S on the left and E/W on the right.
 */
export function whosePoints(
  scorer: Position,
  viewer: Position | null
): { side: PointsSide; column: 'us' | 'them' } {
  if (!viewer) return { side: 'neutral', column: northSouth(scorer) ? 'us' : 'them' };
  return northSouth(scorer) === northSouth(viewer)
    ? { side: 'ours', column: 'us' }
    : { side: 'theirs', column: 'them' };
}

/**
 * The two faces under each score column (PID-383): you, then your partner;
 * the opponent on your left, then the one on your right. You always sit
 * South, so your left is West. A spectator reads N/S and E/W in that order.
 */
export function scoreFaces<S extends { absolutePosition: Position }>(
  seats: Record<RelativePosition, S | null>,
  viewer: Position | null
): Record<'us' | 'them', [S | null, S | null]> {
  if (viewer) return { us: [seats.south, seats.north], them: [seats.west, seats.east] };
  const at = (position: Position) =>
    Object.values(seats).find((seat) => seat?.absolutePosition === position) ?? null;
  return { us: [at('north'), at('south')], them: [at('east'), at('west')] };
}
