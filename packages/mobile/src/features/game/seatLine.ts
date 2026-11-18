/**
 * The line under a seat's name. A bot playing a seat says what it does, like
 * anyone: its badge already says bot (PID-214). In a game's first hand your
 * partner's seat says so whenever it has nothing else to say (PID-383).
 */
import { getRankLabel, SUIT_SYMBOLS, t, type Card, type SeatStatus } from '@pidro/shared';
import type { StatusFit } from '@/features/avatar';

/**
 * `now` is the player on turn, `high` holds the high bid. A new `pulse` lights
 * the seat up once (it just bid). `short` is what your nameless tight seat
 * says; without it, that seat stays quiet.
 */
export type SeatLine = {
  text: string;
  short?: string;
  tone?: 'now' | 'quiet' | 'high' | 'danger' | 'out';
  pulse?: string;
};

/**
 * Out of trumps: the seat sits back, its line says so on a navy plate until
 * the hand ends, and it lights up once as it goes out (PID-450).
 */
const outLine = (): SeatLine => ({
  text: t('game.out'),
  short: t('game.out'),
  tone: 'out',
  pulse: 'out',
});

/**
 * The plate under a seat's name and line (PID-450): lit for the seat on turn,
 * saying "Your turn" on yours and the seat's own line on anyone else's; navy
 * for a seat out of trumps. A bidding winner's held bid (`high`) stays off it.
 */
export function seatPlate(
  line: SeatLine | null,
  { onTurn, isYou }: { onTurn: boolean; isYou: boolean }
): { plate: 'turn' | 'out'; text: string | null } | null {
  if (line?.tone === 'out') return { plate: 'out', text: line.text };
  if (!onTurn || line?.tone === 'high') return null;
  // Taking the rest says so on your plate too (PID-364): the light already says whose turn.
  const yours = line?.text === t('game.takes_rest') ? line.text : t('game.your_turn');
  return { plate: 'turn', text: isYou ? yours : (line?.text ?? null) };
}

/** A card played; where the line has no room, the card alone says it (PID-466). */
export const playsLine = (card: string): SeatLine => ({
  text: t('game.plays', { card }),
  short: card,
});

/** The bidding's winner choosing trump; "Trump…" where a narrow seat has no room for it. */
/**
 * While cards move, only the seat they come from speaks (PID-466): in a deal
 * the dealer says it is dealing, the others nothing; in the cut for dealer a
 * seat says the `card` it cut once that card is `up` on the table.
 */
export const dealingLine = (dealer: boolean): SeatLine | null =>
  dealer ? { text: t('game.dealing') } : null;
export const cutLine = (card: string | null, up: boolean): SeatLine | null =>
  card && up ? { text: t('game.draws', { card }) } : null;

export const choosingTrumpLine = (): SeatLine => ({
  text: t('game.choosing_trump'),
  short: t('game.choosing_trump_short'),
  tone: 'now',
});

/**
 * Where a seat's `shown` (its line, or what its plate says) gives way to the
 * line's short form when it runs out of `room` (PID-450). Plate text that is
 * not the line, like "Your turn", stands as it is. The seat measures the line
 * as it is laid out to decide (`fitStatus`, PID-466), and keeps a lit plate
 * within `room` either way.
 */
export function lineFit(shown: string | null, line: SeatLine | null, room: number): StatusFit {
  return { room, short: shown && line?.short && shown === line.text ? line.short : shown };
}

export function seatLine(
  seat: {
    seatStatus: SeatStatus;
    lastPlayedCard: { card: Card } | null;
    out: boolean;
    isTeammate: boolean;
  },
  override?: SeatLine | null,
  firstHand = false
): SeatLine | null {
  if (seat.seatStatus === 'reconnecting') return { text: t('game.reconnecting'), tone: 'danger' };
  if (seat.seatStatus === 'vacant') return null;
  if (seat.lastPlayedCard) {
    const c = seat.lastPlayedCard.card;
    return playsLine(`${getRankLabel(c.rank)}${SUIT_SYMBOLS[c.suit]}`);
  }
  if (seat.out) return outLine();
  if (override) return override;
  return firstHand && seat.isTeammate ? { text: t('game.your_partner'), tone: 'quiet' } : null;
}

/** What a seat's sheet says under the name at a table: nothing for you, or for a spectator. */
export function teamLine(seat: { isTeammate: boolean; isOpponent: boolean }): string | null {
  if (seat.isTeammate) return t('game.your_partner');
  return seat.isOpponent ? t('game.plays_against_you') : null;
}
