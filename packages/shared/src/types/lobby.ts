import type { SeatPin } from './game';

export type RoomStatus = 'waiting' | 'ready' | 'playing' | 'finished';
export type RuleSet = 'finnish' | 'louisiana';
export type SeatType = 'open' | 'ai' | { type: 'open'; min_games: 0 | 100 | 1000; password?: boolean } | { type: 'held'; user_id: string };
export type BotDifficulty = 'random' | 'basic' | 'smart';
export type Position = 'north' | 'east' | 'south' | 'west';
/** Opaque catalogue identity, not the bot's player/seat ID. */
export type BotPersona = string;
export interface BotProfile {
  id: string;
  name: string;
  description: string;
  avatar_url: string;
}
export type PositionPreference = Position | 'north_south' | 'east_west';

export interface HeldPlayer {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

export interface SeatInvitation {
  code: string;
  position: Position;
  host_id: string;
  host?: HeldPlayer;
  rule_set?: RuleSet;
  held_since?: string;
  /** Across from the host, or on the other team; older servers leave it out. */
  join_as?: 'partner' | 'opponent' | null;
}

export interface SeatRequiresGamesError {
  error: 'SEAT_REQUIRES_GAMES';
  min_games: number;
  games_played: number;
}

export interface ReadinessSnapshot {
  room_id: string;
  config?: RoomConfig;
  ready_epoch: number;
  snapshot_revision: number;
  status: RoomStatus;
  positions: Record<Position, string | null>;
  seats: Record<
    Position,
    {
      occupant_type: 'human' | 'bot' | 'vacant';
      status: string;
      user_id: string | null;
      username?: string | null;
      display_name?: string | null;
      avatar_url?: string | null;
      level?: number | null;
      /** Legend stars past level 100 (PID-337); 0 below it, null for bots. */
      prestige?: number | null;
      pin?: SeatPin | null;
      bot_persona?: BotPersona | null;
      bot_profile?: BotProfile | null;
      /** A bot keeping a player's seat until they come back. */
      has_reservation?: boolean;
      /** Reads typed table talk (PID-318): an adult account. Only the table's channel says. */
      reads_typed?: boolean;
      held_for?: HeldPlayer | null;
      min_games?: number;
      password?: boolean;
    }
  >;
  ready_players: Position[];
}

/**
 * How a table was set up. The server stores it on the room and sends the same
 * shape over REST and over the lobby channel.
 */
export interface RoomConfig {
  rule_set: RuleSet;
  name: string | null;
  bot_difficulty: BotDifficulty;
  solo: boolean;
}

export interface Player {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  level?: number | null;
  /** Legend stars past level 100 (PID-337); 0 below it, null for bots. */
  prestige?: number | null;
  pin?: SeatPin | null;
  is_bot?: boolean;
  /** Set for a real bot (Marcel, Antti, Jocke); null for humans and substitute bots. */
  bot_persona?: BotPersona | null;
  bot_profile?: BotProfile | null;
}

export interface Seat {
  seat_index: number;
  status: 'occupied' | 'free';
  player: Player | null;
  position?: Position;
  player_id?: string | null;
  min_games?: number;
  /** A vacant seat that needs the table's password; never the password itself. */
  password?: boolean;
  vacated_by?: string;
  held_for?: HeldPlayer | null;
}

export interface Room {
  id?: string;
  code: string;
  /** Lifted from `config.name` by `normalizeRoom`, falling back to the room code. */
  name?: string;
  config?: RoomConfig;
  host_id?: string | null;
  /** Sent to the host only: with its room read, its new room and its seat changes. */
  seat_password?: string;
  locked?: boolean;
  status: RoomStatus;
  game?: {
    hand: number;
    scores: { north_south: number; east_west: number };
  };
  player_count?: number;
  players_count?: number;
  max_players?: number;
  created_at?: string;
  last_activity?: string;
  seats?: Seat[];
  player_ids?: string[];
  positions?: {
    north: string | null;
    east: string | null;
    south: string | null;
    west: string | null;
  };
  available_positions?: Position[];
}

export type LobbyCategoryKey =
  'my_rejoinable' | 'open_tables' | 'substitute_needed' | 'spectatable';

export interface LobbyCategories {
  my_rejoinable: Room[];
  open_tables: Room[];
  substitute_needed: Room[];
  spectatable: Room[];
}

/** Everything the server accepts when creating a room. Any other key is rejected. */
export interface CreateRoomRequest {
  name?: string;
  rule_set?: RuleSet;
  seats?: {
    seat_2: SeatType;
    seat_3: SeatType;
    seat_4: SeatType;
  };
}
