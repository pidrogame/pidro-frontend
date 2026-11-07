/**
 * Whose points they were (PID-230): every point a trick scores, a Pidro's
 * five most of all, reads as ours or theirs. The server says who took what;
 * this only reads it from the viewer's seat.
 */
import type { Position } from '@/types/lobby';

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
