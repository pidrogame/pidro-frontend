/**
 * Beginner aids at the table (PID-220), opt-in because pros count in their
 * heads. The server decides who took what; these only add up and word it.
 */
import type { Position } from '@/types/lobby';
import type { ServerPlayerView } from '@/types/game';
import type { ReadinessSnapshot } from '@pidro/shared';

export function isSoloTable(readiness: ReadinessSnapshot | null, you: Position | null): boolean {
  if (!you || readiness?.seats[you]?.occupant_type !== 'human') return false;
  return (['north', 'east', 'south', 'west'] as const).every(
    (position) => position === you || readiness.seats[position]?.occupant_type === 'bot'
  );
}

/**
 * A finished table someone left: the server reopens it as waiting. A rematch
 * passes through ready, everybody in, on its way to the next game; that is no
 * reopening.
 */
export function isReopenedTable(
  readiness: ReadinessSnapshot | null,
  hasGameState: boolean
): boolean {
  return readiness?.status === 'waiting' && hasGameState;
}

/** The one player still holding trumps once the other three have gone cold. */
export function loneTrumpHolder(
  players: Partial<Record<Position, ServerPlayerView>> | null | undefined
): Position | null {
  const left = (['north', 'east', 'south', 'west'] as const).filter(
    (position) => players?.[position] && !players[position]?.eliminated
  );
  const out = (['north', 'east', 'south', 'west'] as const).filter(
    (position) => players?.[position]?.eliminated
  );
  return left.length === 1 && out.length === 3 ? left[0] : null;
}
