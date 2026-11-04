import type {
  LobbyCategories,
  LobbyCategoryKey,
  Position,
  Room,
  RoomStatus,
  Seat,
} from '../types/lobby';
import { INDEX_TO_POSITION, POSITION_TO_INDEX } from './positions';
import { publicPlayerName } from './playerName';

function normalizeSeat(raw: any, fallbackIndex: number): Seat {
  const seatIndex =
    typeof raw?.seat_index === 'number' && Number.isFinite(raw.seat_index)
      ? raw.seat_index
      : fallbackIndex;

  const position: Position | undefined = raw?.position ?? INDEX_TO_POSITION[seatIndex] ?? undefined;

  const player =
    raw?.player ??
    (raw?.player_id
      ? {
          id: String(raw.player_id),
          username: publicPlayerName(raw.player_username, ''),
          display_name: raw.player_display_name ?? null,
          is_bot: raw.player_is_bot ?? false,
          avatar_url: raw.player_avatar_url ?? null,
        }
      : null);

  const status: 'occupied' | 'free' = raw?.status === 'occupied' || player ? 'occupied' : 'free';

  return {
    seat_index: seatIndex,
    position,
    status,
    player: player ?? null,
    player_id: raw?.player_id ?? player?.id ?? null,
    min_games: raw?.min_games ?? 0,
    password: raw?.password === true,
    vacated_by: raw?.vacated_by,
    held_for: raw?.held_for,
  };
}

export function buildPositionsFromSeats(
  seats?: Seat[]
): Record<Position, string | null> | undefined {
  if (!seats?.length) return undefined;

  const positions: Record<Position, string | null> = {
    north: null,
    east: null,
    south: null,
    west: null,
  };

  seats.forEach((seat) => {
    if (!seat.position) return;
    positions[seat.position] = seat.player?.id ?? seat.player_id ?? null;
  });

  return positions;
}

/**
 * The REST room payload (`GET /rooms/:code`) keys seats by position
 * (`{north: {user_id, substitute, ...}}`) instead of the array shape the
 * lobby channel sends. Bots are detectable only by the `bot_*` user id —
 * `substitute: true` also marks HUMANS who filled an open seat, and
 * `occupant_type` is unreliable in this payload.
 */
function seatsFromPositionMap(rawSeats: Record<string, any>): any[] {
  return Object.entries(rawSeats).map(([key, value]) => {
    const position = (value?.position ?? key) as Position;
    const userId = value?.user_id ?? value?.player_id ?? null;
    // Bot-substituted seats carry occupant_type: 'bot' with a null user_id,
    // so check both signals.
    const isBot =
      value?.occupant_type === 'bot' ||
      (typeof userId === 'string' && userId.startsWith('bot_'));
    const username = value?.username ?? value?.player_username ?? null;
    const displayName = value?.display_name ?? value?.player_display_name ?? null;
    const playerId = userId ?? (isBot ? `bot_${String(position)}` : null);

    return {
      seat_index: POSITION_TO_INDEX[position],
      position,
      status: playerId ? 'occupied' : 'free',
      player:
        playerId
          ? {
              id: String(playerId),
              username: publicPlayerName(username, ''),
              display_name: displayName,
              is_bot: isBot,
              avatar_url: value?.avatar_url ?? null,
              level: value?.level,
              prestige: value?.prestige,
              pin: value?.pin,
              bot_persona: value?.bot_persona,
              bot_profile: value?.bot_profile,
            }
          : null,
      player_id: playerId,
      min_games: value?.min_games,
      password: value?.password === true,
      vacated_by: value?.vacated_by,
      held_for: value?.held_for,
    };
  });
}

/**
 * The server rejects a room name longer than 60 characters. It counts grapheme
 * clusters; the client clamps by code point, which is never the larger count,
 * so a clamped name always passes.
 */
export const ROOM_NAME_MAX_LENGTH = 60;

/**
 * Keeps the first `ROOM_NAME_MAX_LENGTH` code points of what is typed into a
 * room name field. Unlike `clampRoomName` it leaves trailing whitespace alone,
 * so the space between two words survives the keystroke that types it.
 */
export function limitRoomNameInput(text: string): string {
  // A UTF-16 length within the limit cannot hold more code points than that.
  if (text.length <= ROOM_NAME_MAX_LENGTH) return text;
  const codePoints = Array.from(text);
  if (codePoints.length <= ROOM_NAME_MAX_LENGTH) return text;
  return codePoints.slice(0, ROOM_NAME_MAX_LENGTH).join('');
}

/**
 * Cuts a room name down to the server's limit. Default names embed the
 * username, which has no maximum length. Counts code points, so a surrogate
 * pair is never split and 60 emoji fit; the server counts grapheme clusters,
 * so a multi-code-point sequence such as a flag or a family emoji on the
 * boundary can still lose part of itself.
 */
export function clampRoomName(name: string): string {
  const limited = limitRoomNameInput(name);
  return limited === name ? name : limited.trimEnd();
}

export function normalizeRoom(raw: any): Room {
  const rawSeats =
    raw?.seats && !Array.isArray(raw.seats) && typeof raw.seats === 'object'
      ? seatsFromPositionMap(raw.seats)
      : raw?.seats;

  const seats = Array.isArray(rawSeats)
    ? rawSeats.map((seat: any, idx: number) => normalizeSeat(seat, idx))
    : [];

  const positions = raw?.positions ?? buildPositionsFromSeats(seats);

  const availablePositions: Position[] = raw?.locked
    ? []
    : (raw?.available_positions ??
      seats
        .filter((seat: Seat) => seat.position && seat.status !== 'occupied')
        .map((seat: Seat) => seat.position!) ??
      []);

  const occupiedCount = seats.filter((seat: Seat) => seat.status === 'occupied' || !!seat.player).length;

  const playerCount =
    raw?.player_count ??
    raw?.players_count ??
    (Array.isArray(raw?.player_ids) ? raw.player_ids.length : occupiedCount);

  const status: RoomStatus = (raw?.status as RoomStatus | undefined) ?? 'waiting';

  // `config.name` is the server's word and comes first. The server never sends
  // a top-level `name`; one only exists on a room that was normalized before,
  // where it may be a stale lifted value such as the room code.
  // `metadata.name` is what a backend that predates the room config sends over
  // the lobby channel. This client ships before that backend is replaced, so
  // keep reading it until the config-emitting backend is deployed everywhere.
  const name =
    raw?.config?.name ?? raw?.name ?? raw?.metadata?.name ?? raw?.code ?? 'Game Room';

  return {
    ...raw,
    id: raw?.id ?? raw?.room_id ?? undefined,
    code: raw?.code ?? raw?.room_code ?? raw?.id ?? '',
    name,
    config: {
      name: null,
      bot_difficulty: 'basic',
      solo: false,
      ...raw?.config,
      rule_set: raw?.config?.rule_set ?? 'finnish',
    },
    host_id: raw?.host_id ?? raw?.hostId ?? raw?.host?.id ?? null,
    locked: raw?.locked ?? false,
    status,
    player_count: playerCount,
    players_count: playerCount,
    max_players: raw?.max_players ?? raw?.maxPlayers ?? 4,
    created_at: raw?.created_at ?? raw?.inserted_at ?? raw?.createdAt,
    last_activity: raw?.last_activity ?? raw?.updated_at ?? raw?.updatedAt,
    seats,
    positions,
    available_positions: availablePositions,
  };
}

export function normalizeRooms(rawRooms: any): Room[] {
  if (!Array.isArray(rawRooms)) return [];
  return rawRooms.map((room) => normalizeRoom(room));
}

export const lobbyCategoryKeys: LobbyCategoryKey[] = [
  'my_rejoinable',
  'open_tables',
  'substitute_needed',
  'spectatable',
];

export function emptyLobbyCategories(): LobbyCategories {
  return {
    my_rejoinable: [],
    open_tables: [],
    substitute_needed: [],
    spectatable: [],
  };
}

export function normalizeLobbyCategories(rawLobby: any): LobbyCategories {
  const normalized = emptyLobbyCategories();
  lobbyCategoryKeys.forEach((key) => {
    normalized[key] = normalizeRooms(rawLobby?.[key]);
  });
  return normalized;
}

export function flattenLobbyCategories(lobby: LobbyCategories): Room[] {
  const seen = new Set<string>();
  const rooms: Room[] = [];

  lobbyCategoryKeys.forEach((key) => {
    lobby[key].forEach((room) => {
      if (!room.code || seen.has(room.code)) return;
      seen.add(room.code);
      rooms.push(room);
    });
  });

  return rooms;
}

export function hasLobbyCategories(rawLobby: any): boolean {
  return lobbyCategoryKeys.some((key) => Array.isArray(rawLobby?.[key]));
}
