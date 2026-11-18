/**
 * Beginner aids at the table (PID-220), opt-in because pros count in their
 * heads. The server decides who took what; these only add up and word it.
 */
import type { Position, Room } from '@/types/lobby';
import type { ServerPlayerView } from '@/types/game';
import type { TableNotice } from '@/game/tableNotices';
import { publicPlayerName, type ReadinessSnapshot } from '@pidro/shared';

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

/**
 * Game over offers the host a way back to the seats (PID-439) while a bot
 * sits at a table others can join. A solo table is hidden from the lobby; a
 * bot keeping a player's seat until they come back is that player.
 */
export function canSwapBot(
  room: Pick<Room, 'host_id' | 'config'>,
  readiness: ReadinessSnapshot | null,
  you: string,
  role: 'player' | 'spectator' | null
): boolean {
  return (
    role === 'player' &&
    !!you &&
    room.host_id === you &&
    !room.config?.solo &&
    Object.values(readiness?.seats ?? {}).some(
      (seat) => seat?.occupant_type === 'bot' && !seat.has_reservation
    )
  );
}

/**
 * What a reopened table says. The host who reopened it to change the seats
 * reads nothing, the others read who; a leave, or a server that does not say,
 * keeps "A player left".
 */
export function reopenedNotice(
  readiness: ReadinessSnapshot | null,
  hostId: string | null | undefined,
  you: string
): TableNotice | null {
  if (readiness?.reopened_by !== 'host') return { key: 'table.reopened', variant: 'warning' };
  if (hostId === you) return null;
  const host = Object.values(readiness.seats).find((seat) => seat?.user_id === hostId);
  return {
    key: 'table.reopenedByHost',
    variant: 'warning',
    seat: { name: host ? publicPlayerName(host.username, '', host.display_name) : null },
  };
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
