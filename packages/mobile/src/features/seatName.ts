import {
  mapAbsoluteToRelative,
  publicPlayerName,
  seatPlayerName,
  t,
  type Player,
  type Position,
  type RelativePlayerView,
} from '@pidro/shared';

type SeatPlayer = Pick<Player, 'username'> & Partial<Player>;

/**
 * What a seat is called. A bot with a persona goes by the server's name for
 * it (Marcel, Antti, Jocke); a bot from an older server is just "Bot". A
 * substitute bot has no persona: the seat keeps its player's own name.
 */
export function seatName(
  player: SeatPlayer | null | undefined,
  fallback: string,
  bot = !!player?.is_bot
): string {
  if (player?.bot_persona) return seatPlayerName(player, t('game.bot'));
  if (bot) return t('game.bot');
  return publicPlayerName(player?.username, fallback, player?.display_name);
}

/**
 * A server seat as the viewer sees it on screen: the table turns so the viewer
 * sits South, and a spectator sees the server's own seats.
 */
export const screenSeatKey = (position: Position, viewer: Position | null) =>
  `game.seat_${mapAbsoluteToRelative(position, viewer ?? 'south')}` as const;

/**
 * Who sat in a server seat at the table: "You", their name, or without one
 * (a player who left, an older server) the seat where they sit on screen.
 * Never the server's compass word, which points the wrong way once the table turns.
 */
export function tableSeatName(
  position: Position,
  players: readonly Pick<RelativePlayerView, 'absolutePosition' | 'username'>[],
  viewer: Position | null
): string {
  if (position === viewer) return t('game.you');
  return (
    players.find((player) => player.absolutePosition === position)?.username ||
    t(screenSeatKey(position, viewer))
  );
}
