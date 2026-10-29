import type { BotPersona, BotProfile, Position, RuleSet } from './lobby';
import type { TablePace } from '../stores/settings';

export type SeatStatus = 'normal' | 'reconnecting' | 'bot_substitute' | 'permanent_bot' | 'vacant';
/** The pin a seat wears: `classic` for a Pidro Classic player. */
export type SeatPin = 'classic';
export interface SeatLifecycleSnapshot {
  room_id: string;
  room_code: string;
  revision: number;
  owner_id: string | null;
  room_status: string;
  seats: Record<
    Position,
    {
      status: SeatStatus;
      player_id: string | null;
      username: string | null;
      display_name?: string | null;
      avatar_url?: string | null;
      level?: number | null;
      pin?: SeatPin | null;
      bot_persona?: BotPersona | null;
      bot_profile?: BotProfile | null;
      decision: { id: string; player_name: string | null } | null;
    }
  >;
}
export type TurnTimerScope = 'seat' | 'room';

export type GamePhase =
  | 'dealer_selection'
  | 'dealing'
  | 'bidding'
  | 'declaring'
  | 'declaring_trump'
  | 'trump_declaration'
  | 'discarding'
  | 'second_deal'
  | 'playing'
  | 'scoring'
  | 'hand_complete'
  | 'complete'
  | 'game_over';

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

export interface Card {
  rank: number;
  suit: Suit;
}

export interface DealerRobPresentation {
  dealer: Position;
  automatic?: boolean;
  started_at_ms: number;
  ends_at_ms: number;
  /** Present only for the dealer's private channel payload. */
  pool?: Card[];
  kept?: Card[];
  discarded?: Card[];
}

export interface GamePresentation {
  dealer_selection?: { started_at_ms: number; ends_at_ms: number } | null;
  dealer_rob?: DealerRobPresentation | null;
}

export interface ServerPlayerView {
  hand?: Card[] | number;
  card_count?: number;
  /** Out of trumps ("cold"): the player sits out the rest of the hand. */
  eliminated?: boolean;
  /** Remaining cards folded face down; public, without their faces. */
  folded_count?: number;
  /** Legacy cold-player payload. Render only its count, never its faces. */
  revealed_cards?: Card[];
  /**
   * The second deal, public to every seat: trumps kept after the discard and
   * cards drawn to refill (the dealer's from the pack). Null until that seat's
   * second deal is done; the dealer's stays null while they rob the pack.
   */
  kept_count?: number | null;
  drawn_count?: number | null;
  /**
   * How many cards this seat threw away in the second deal (PID-306): the
   * dealer's once they are down to six. Absent from older servers.
   */
  discarded_count?: number | null;
}

export interface ServerTrickPlay {
  player: Position;
  card: Card;
}

export type TeamKey = 'north_south' | 'east_west';

/** The 2 of trump's point stays with whoever played it, whoever takes the trick. */
export interface ServerTwoOfTrump {
  position: Position;
  points: number;
}

export interface ServerTrick {
  cards: ServerTrickPlay[];
  winner: Position;
  /** The winner's share, without the 2 of trump. */
  points?: number;
  two_of_trump?: ServerTwoOfTrump | null;
}

/** The trick in progress, as the server's rules see it (PID-218). */
export interface ServerTrickDetails {
  number?: number;
  leader?: Position;
  plays?: ServerTrickPlay[];
  /** The play that would take the trick if it ended now. */
  winning?: { position: Position; card: Card } | null;
  /** What the trick holds so far for its winner, without the 2 of trump. */
  points?: number;
  two_of_trump?: ServerTwoOfTrump | null;
}

/** One bid or pass, in the order the server recorded it. */
export interface ServerBid {
  position: Position;
  amount: number | 'pass';
}

/** A card that scored in a hand, and who kept it: the trick's winner, or the 2 of trump's player. */
export interface ServerPointCard {
  card: Card;
  points: number;
  position: Position;
  team: TeamKey;
}

/** A scored hand, as `hand_history` keeps it (PID-233). */
export interface ServerHandSummary {
  hand_number: number;
  bidding_team: TeamKey;
  bidder: Position;
  bid: number;
  captured: Record<TeamKey, number>;
  made: boolean;
  delta: Record<TeamKey, number>;
  scores: Record<TeamKey, number>;
  trump?: Suit | null;
  /** Every card that scored, in play order; each team's add up to its `captured`. Absent from older servers. */
  point_cards?: ServerPointCard[];
}

/** How the last scored hand ended; kept until the next hand's first trick is done. */
export interface ServerLastHand extends ServerHandSummary {
  /** The finished hand itself (PID-221), final trick included; absent from older servers. */
  bids?: ServerBid[];
  tricks?: ServerTrick[];
}

export interface ServerGameState {
  phase: GamePhase;
  /** Optional diagnostics cursor. Room codes alone do not identify a rematch. */
  game_instance_id?: string;
  state_revision?: number;
  /** Presentation delay carried alongside this snapshot on the channel. */
  transition_delay_ms?: number;
  variant?: RuleSet;
  /** Missing on older servers: Quick, with no Continue gate. */
  pace?: TablePace;
  awaiting_continue?: boolean;
  winner?: 'north_south' | 'east_west' | null;
  hand_number?: number | null;
  current_player: Position | null;
  players: Record<Position, ServerPlayerView>;
  highest_bid?: { position: Position; amount: number | 'pass' };

  config?: {
    min_bid?: number;
    max_bid?: number;
    allow_negative_scores?: boolean;
    winning_score?: number;
    initial_deal_count?: number;
    final_hand_size?: number;
  };

  bids?: Record<Position, number | 'pass'>;
  /** `bids` in the order they were made; absent when the server sent a record. */
  bid_order?: ServerBid[];
  current_bid?: number;
  bid_winner?: Position | null;
  bid_team?: 'north_south' | 'east_west' | null;

  trump?: Suit | null;
  /**
   * Trumps killed over six, face up for everyone from the start of play until
   * the hand ends (PID-306). Absent from older servers.
   */
  killed_cards?: Partial<Record<Position, Card[]>>;

  current_trick?: ServerTrickPlay[];
  current_trick_details?: ServerTrickDetails | null;
  tricks?: ServerTrick[];
  last_hand?: ServerLastHand | null;
  /** Every scored hand of the game, oldest first. */
  hand_history?: ServerHandSummary[];

  scores?: {
    north_south: number;
    east_west: number;
  };

  dealer?: Position | null;
  dealer_selection_cuts?: Record<Position, Card> | null;
  round_number?: number;
}

export interface ServerTurnTimerPayload {
  timer_id: number;
  scope: TurnTimerScope;
  position: Position | null;
  phase: GamePhase;
  duration_ms: number;
  transition_delay_ms: number;
  server_time: string;
  remaining_ms?: number;
  event_seq: number;
}

export interface ActiveTurnTimer {
  timerId: number;
  scope: TurnTimerScope;
  position: Position | null;
  phase: GamePhase;
  durationMs: number;
  transitionDelayMs: number;
  serverTime: string;
  remainingMs: number;
  receivedAtMs: number;
  eventSeq: number;
}

/** Progression shown on avatars: the number is the level (dedication), the
 *  chip's metal is the skill tier. Tier ids match the web ranking module. */
export interface PlayerRank {
  level: number;
  tier: string;
  prestige: number;
  /** Veteran progress toward the next level, 0–1 (profile/game-over only). */
  progress?: number;
}

export interface PlayerMeta {
  position: Position;
  playerId: string | null;
  username: string | null;
  avatar_url?: string | null;
  isYou: boolean;
  isTeammate: boolean;
  isOpponent: boolean;
  isConnected: boolean;
  seatStatus: SeatStatus;
  rank?: PlayerRank | null;
  /** All-time level; null for bots and open seats. */
  level?: number | null;
  pin?: SeatPin | null;
  bot_persona?: BotPersona | null;
  bot_profile?: BotProfile | null;
}

export type RelativePosition = 'north' | 'east' | 'south' | 'west';

export interface RelativePlayerView {
  absolutePosition: Position;
  relativePosition: RelativePosition;
  playerId: string | null;
  username: string | null;
  avatar_url?: string | null;
  isYou: boolean;
  isTeammate: boolean;
  isOpponent: boolean;
  isConnected: boolean;
  isCurrentTurn: boolean;
  seatStatus: SeatStatus;
  rank?: PlayerRank | null;
  /** All-time level; null for bots and open seats. */
  level?: number | null;
  pin?: SeatPin | null;
  bot_persona?: BotPersona | null;
  bot_profile?: BotProfile | null;
}

export interface GameViewModel {
  roomCode: string;
  phase: GamePhase;
  viewerPositionAbsolute: Position;
  trumpSuit: Suit | null;
  dealerAbsolute: Position | null;
  dealerRelative: RelativePosition | null;
  currentTurnAbsolute: Position | null;
  currentTurnRelative: RelativePosition | null;
  players: RelativePlayerView[];
}

export interface PassAction {
  type: 'pass';
}

export interface BidAction {
  type: 'bid';
  amount: number;
}

export interface PlayCardAction {
  type: 'play_card';
  card: Card;
}

export interface DeclareTrumpAction {
  type: 'declare_trump';
  suit: Suit;
}

export interface SelectHandAction {
  type: 'select_hand';
  cards: Card[];
}

export interface SelectDealerAction {
  type: 'select_dealer';
}

export type LegalAction =
  | PassAction
  | BidAction
  | PlayCardAction
  | DeclareTrumpAction
  | SelectHandAction
  | SelectDealerAction;
