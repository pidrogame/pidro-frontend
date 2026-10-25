/**
 * Game over (PID-237): what the result screen picks out of the server's record
 * of the game. Nothing here scores anything; it only chooses what to show.
 */
import {
  SUIT_SYMBOLS,
  t,
  type Card,
  type ServerHandSummary,
  type ServerLastHand,
  type TeamKey,
} from '@pidro/shared';

/** The hand where `team` gained the most, or null when it never gained. */
export function bestHand(
  history: readonly ServerHandSummary[] | null | undefined,
  team: TeamKey
): ServerHandSummary | null {
  let best: ServerHandSummary | null = null;
  for (const hand of history ?? []) {
    if (hand.delta[team] > 0 && hand.delta[team] > (best?.delta[team] ?? 0)) best = hand;
  }
  return best;
}

/** The point cards `team` took in a hand, in play order. */
export function pointCardsTaken(hand: ServerHandSummary, team: TeamKey): Card[] {
  return (hand.point_cards ?? []).filter((card) => card.team === team).map((card) => card.card);
}

/** Both fives, the Pidros, went to `team`. */
export function tookBothPidros(hand: ServerHandSummary, team: TeamKey): boolean {
  return pointCardsTaken(hand, team).filter((card) => card.rank === 5).length === 2;
}

/** "Hand 7. You took both Pidros." when `team` took both, else "Hand 7. Mikko bid 11 ♠." */
export function bestHandLine(hand: ServerHandSummary, team: TeamKey, bidder: string): string {
  const number = hand.hand_number;
  if (tookBothPidros(hand, team)) return t('game.best_hand_pidros', { number });
  const suit = hand.trump ? ` ${SUIT_SYMBOLS[hand.trump]}` : '';
  return t('game.best_hand_bid', { number, bidder, bid: hand.bid, suit });
}

/** The card that took the last trick, and two of the trick's other cards. */
export function lastTrickReveal(
  lastHand: ServerLastHand | null | undefined
): { winner: Card; others: Card[] } | null {
  const trick = lastHand?.tricks?.at(-1);
  const winner = trick?.cards.find((play) => play.player === trick.winner);
  if (!trick || !winner) return null;
  return {
    winner: winner.card,
    others: trick.cards
      .filter((play) => play !== winner)
      .map((play) => play.card)
      .slice(0, 2),
  };
}

/**
 * Both teams' totals after each hand, from 0–0, and the hand after which the
 * winner never again failed to lead: the moment the lead changed for good.
 * `turn` is null when the winner led all game, or nobody won.
 */
export function raceLine(
  history: readonly ServerHandSummary[] | null | undefined,
  us: TeamKey
): { us: number[]; them: number[]; turn: number | null } {
  const them: TeamKey = us === 'north_south' ? 'east_west' : 'north_south';
  const ours = [0, ...(history ?? []).map((hand) => hand.scores[us])];
  const theirs = [0, ...(history ?? []).map((hand) => hand.scores[them])];
  const last = ours.length - 1;
  const lead = Math.sign(ours[last] - theirs[last]);
  let turn = 0;
  for (let index = 0; index <= last; index++) {
    if (Math.sign(ours[index] - theirs[index]) !== lead) turn = index;
  }
  return { us: ours, them: theirs, turn: lead === 0 || turn === 0 ? null : turn + 1 };
}

/** "Kalle", "Kalle and Mikko", "Nora, Kalle and Mikko". */
export function nameList(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? '';
  const first = names[0];
  const last = names[names.length - 1];
  if (names.length === 2) return t('game.list_two', { first, last });
  return t('game.list_more', { first, rest: names.slice(1, -1).join(', '), last });
}

export interface RematchOther {
  name: string;
  bot: boolean;
  agreed: boolean;
}

/**
 * The rematch row's two lines: who wants another game, and who it waits on.
 * Bots are always in, so nobody waits on them, but they never "want" one.
 */
export function rematchLines(
  others: readonly RematchOther[],
  youAgreed: boolean
): { title: string | null; detail: string | null } {
  const asked = others.filter((other) => other.agreed && !other.bot).map((other) => other.name);
  const waiting = others.filter((other) => !other.agreed).map((other) => other.name);
  const title =
    asked.length === 0
      ? null
      : asked.length === 1
        ? t('game.wants_rematch', { name: asked[0] })
        : t('game.want_rematch', { names: nameList(asked) });
  if (youAgreed) {
    return {
      title: t('game.rematch_youre_in'),
      detail: waiting.length ? t('game.waiting_for', { name: nameList(waiting) }) : null,
    };
  }
  if (!waiting.length) return { title, detail: t('game.rematch_waiting_you') };
  return {
    title,
    detail: asked.length ? t('game.waiting_for', { name: nameList(waiting) }) : null,
  };
}

/** Everyone else at the table is a bot: they always agree, so there is no vote to show. */
export function othersAreBots(others: readonly RematchOther[]): boolean {
  return others.length > 0 && others.every((other) => other.bot);
}

/** "3 in a row with Nora" from two wins together; one win is no streak yet. */
export function streakChip(
  partner: { display_name: string; wins_in_a_row: number } | null | undefined
): { count: number; name: string } | null {
  if (!partner || partner.wins_in_a_row < 2) return null;
  return { count: partner.wins_in_a_row, name: partner.display_name };
}

/** The XP the game earned, for its one chip. */
export function xpChip(summary: { xp_earned: number } | null | undefined): { xp: number } | null {
  return summary ? { xp: summary.xp_earned } : null;
}
