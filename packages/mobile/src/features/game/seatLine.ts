/**
 * The line under a seat's name. A bot playing a seat says what it does, like
 * anyone: its badge already says bot (PID-214). In a game's first hand your
 * partner's seat says so whenever it has nothing else to say (PID-383).
 */
import { getRankLabel, SUIT_SYMBOLS, t, type Card, type SeatStatus } from '@pidro/shared';

/**
 * `now` is the player on turn, `high` holds the high bid. A new `pulse` lights
 * the seat up once (it just bid). `short` is what your nameless tight seat
 * says; without it, that seat stays quiet.
 */
export type SeatLine = {
  text: string;
  short?: string;
  tone?: 'now' | 'quiet' | 'high' | 'danger';
  pulse?: string;
};

/** Out of trumps: the seat sits back, its line says so. */
const outLine = (): SeatLine => ({ text: t('game.out'), short: t('game.out'), tone: 'quiet' });

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
    return { text: t('game.plays', { card: `${getRankLabel(c.rank)}${SUIT_SYMBOLS[c.suit]}` }) };
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
