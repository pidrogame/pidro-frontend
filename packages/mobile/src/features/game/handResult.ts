/**
 * What the end-of-hand panel shows (PID-236), read from the viewer's seat: the
 * bid, how it went, and the point cards each team took. The server says what
 * every card was worth and who kept it; this only sorts it into the trays.
 */
import type { Card, ServerGameState, ServerLastHand, Suit, TeamKey } from '@/types/game';
import type { Position } from '@/types/lobby';
import { PIDRO_POINTS, type PointsSide } from './points';
import { handHeadlines, tableLine } from './tableVoice';

export function waitsForContinue(
  state: Pick<ServerGameState, 'pace' | 'awaiting_continue'>
): boolean {
  return state.pace === 'own' && state.awaiting_continue === true;
}

/**
 * How long the panel stays before the next hand is dealt: long enough to see
 * who took what, with no button to press (2026-10-17: 2-3 s was "wicked
 * fast"). One object so the fixture's tuner can change it live; the server's
 * hand_transition_delay_ms holds the next hand's bidding for as long, plus
 * the deal.
 */
export const handResultTiming = { showMs: 6000 };
export const HAND_RESULT_DEFAULTS = { ...handResultTiming };
export function setHandResultTiming(next: Partial<typeof handResultTiming>) {
  Object.assign(handResultTiming, next);
}

export type HandOutcome =
  | 'we-made'
  | 'we-missed'
  | 'they-made'
  | 'they-missed'
  // A spectator takes no side.
  | 'made'
  | 'missed';

export type HandResultTray = {
  team: TeamKey;
  side: PointsSide;
  points: number;
  cards: { card: Card; points: number }[];
};

export type HandResultView = {
  outcome: HandOutcome;
  /** The team that captured all 14, independent of the bid and viewer. */
  all14: TeamKey | null;
  /** Our made bid or either team's all-14 is gold and stamped in. */
  loud: boolean;
  /** Says whose bid it was: ours, theirs, or a team by name for a spectator. */
  headline: { key: (typeof handHeadlines)[HandOutcome][number] | 'game.all_14'; n?: number };
  bidder: Position;
  bid: number;
  trump: Suit | null;
  /** What the bidders won. */
  won: number;
  /** When they missed: the player on our team who took a five. */
  pidro: Position | null;
  /** Us then them; N/S then E/W for a spectator. */
  trays: [HandResultTray, HandResultTray];
  closeMs: number;
};

const teamOf = (position: Position): TeamKey =>
  position === 'north' || position === 'south' ? 'north_south' : 'east_west';
const other = (team: TeamKey): TeamKey => (team === 'north_south' ? 'east_west' : 'north_south');

/** Captured points are authoritative; a bid or score delta of 14 is not a sweep. */
export function all14Team(hand: ServerLastHand): TeamKey | null {
  if (hand.captured.north_south === 14) return 'north_south';
  if (hand.captured.east_west === 14) return 'east_west';
  return null;
}

export function celebratesAll14(hand: ServerLastHand, viewer: Position | null): boolean {
  return viewer !== null && all14Team(hand) === teamOf(viewer);
}

export function handResultView(
  hand: ServerLastHand,
  viewer: Position | null,
  room: string
): HandResultView {
  const us = viewer ? teamOf(viewer) : 'north_south';
  const all14 = all14Team(hand);
  const ours = hand.bidding_team === us;
  const outcome: HandOutcome = !viewer
    ? hand.made
      ? 'made'
      : 'missed'
    : `${ours ? 'we' : 'they'}-${hand.made ? 'made' : 'missed'}`;
  const won = hand.captured[hand.bidding_team];
  const pointCards = hand.point_cards ?? [];
  const tray = (team: TeamKey): HandResultTray => ({
    team,
    side: !viewer ? 'neutral' : team === us ? 'ours' : 'theirs',
    points: hand.captured[team],
    cards: pointCards
      .filter((pointCard) => pointCard.team === team)
      .map(({ card, points }) => ({ card, points })),
  });
  const ourFive =
    outcome === 'they-missed'
      ? pointCards.find((pointCard) => pointCard.team === us && pointCard.points >= PIDRO_POINTS)
      : undefined;
  return {
    outcome,
    all14,
    loud: all14 !== null || outcome === 'we-made',
    headline: all14
      ? { key: 'game.all_14' }
      : {
          key: tableLine(room, hand.hand_number, handHeadlines[outcome], 'result'),
          ...(!hand.made && { n: hand.bid - won }),
        },
    bidder: hand.bidder,
    bid: hand.bid,
    trump: hand.trump ?? null,
    won,
    pidro: ourFive?.position ?? null,
    trays: [tray(us), tray(other(us))],
    closeMs: handResultTiming.showMs,
  };
}
