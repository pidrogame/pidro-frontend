/**
 * The hand as a list of plain lines, for the plaque's ticker and the hand log:
 * who bid what, trump, who killed which trumps over six, every card played, who took each trick and what the
 * server says it was worth, and how the hand scored. Built from one state
 * snapshot, so a reconnect rebuilds it whole. The server decides winners and
 * points; this only words them. Never throws on malformed state: a piece it
 * cannot read is left out.
 */
import type {
  Card,
  RelativePlayerView,
  ServerBid,
  ServerLastHand,
  Suit,
  TeamKey,
} from '@/types/game';
import { isNorthSouthTeam, t, type TranslationKey, type TranslationValues } from '@pidro/shared';
import type { Position } from '@/types/lobby';
import { getRankLabel, SUIT_SYMBOLS } from '@/utils/cards';
import { screenSeatKey, tableSeatName } from '@/features/seatName';

export type HandLogKind = 'bid' | 'trump' | 'kill' | 'play' | 'trick' | 'two' | 'result';

export type HandLogEntry = {
  /** Stable across snapshots: the same action keeps its id when the hand moves on. */
  id: string;
  kind: HandLogKind;
  /** Who acted, the part that may truncate on a narrow ticker; null for trump. */
  who: string | null;
  /** What they did; never truncated. */
  what: string;
  text: string;
  /** Your side's line; null for spectators and for trump. */
  ours: boolean | null;
  hand: number;
  /** The trick a play, take or 2 belongs to, from 1. */
  trick: number | null;
  presentation?: {
    who: string | null;
    whoKey?: TranslationKey;
    key: TranslationKey;
    values: TranslationValues;
  };
};

export type HandLogGroup = {
  hand: number;
  /** True once the server has scored the hand. */
  finished: boolean;
  entries: HandLogEntry[];
};

export type HandLogInput = {
  handNumber: number | null;
  /** The current hand's bids in the order made; unknown order shows no bids. */
  bids: ServerBid[] | null | undefined;
  trump: Suit | null;
  /** The current hand's trumps killed over six, by seat; the server sends them once play starts. */
  killed?: Partial<Record<Position, Card[]>> | null;
  /** Finished tricks this hand, as the server sends them. */
  tricks: unknown;
  /** Plays of the trick in progress. */
  currentTrick: unknown;
  lastHand: ServerLastHand | null;
  players: Pick<RelativePlayerView, 'absolutePosition' | 'username' | 'isYou'>[];
};

type RawPlay = { player?: Position; position?: Position; card?: Card };
type RawTrick = {
  winner?: Position;
  points?: number;
  two_of_trump?: { position?: Position; points?: number } | null;
};

const POSITIONS = new Set<string>(['north', 'east', 'south', 'west']);
const isPosition = (value: unknown): value is Position =>
  typeof value === 'string' && POSITIONS.has(value);
const teamOf = (position: Position): TeamKey =>
  isNorthSouthTeam(position) ? 'north_south' : 'east_west';

function playsOf(trick: unknown): RawPlay[] {
  const plays = Array.isArray(trick)
    ? trick
    : trick && typeof trick === 'object'
      ? ((trick as { cards?: unknown; plays?: unknown }).cards ??
        (trick as { plays?: unknown }).plays)
      : null;
  return Array.isArray(plays) ? (plays as RawPlay[]) : [];
}

const cardText = (card: Card) => `${getRankLabel(card.rank)}${SUIT_SYMBOLS[card.suit] ?? ''}`;
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const say = (
  who: string | null,
  key: TranslationKey,
  values: TranslationValues = {},
  whoKey?: TranslationKey
) => {
  const translatedWho = whoKey ? t(whoKey) : who;
  const text = t(key, { ...values, who: translatedWho ?? '' });
  // The ticker may truncate the name separately; sentences are always translated whole.
  const prefix = translatedWho && text.startsWith(`${translatedWho} `) ? `${translatedWho} ` : '';
  return {
    who: prefix ? translatedWho : null,
    what: prefix ? text.slice(prefix.length) : text,
    text,
    presentation: { who: whoKey ? null : who, whoKey, key, values },
  };
};

/** Retained ticker entries can outlive the snapshot that originally built them. */
export function presentHandLogEntry(entry: HandLogEntry): HandLogEntry {
  const p = entry.presentation;
  return p ? { ...entry, ...say(p.who, p.key, p.values, p.whoKey) } : entry;
}

export function buildHandLog(input: HandLogInput): HandLogGroup[] {
  const you = input.players.find((player) => player.isYou);
  const yourTeam = you ? teamOf(you.absolutePosition) : null;
  const viewer = you?.absolutePosition ?? null;
  const name = (position: Position) => tableSeatName(position, input.players, viewer);
  const isYou = (position: Position) => position === viewer;
  const nameKey = (position: Position): TranslationKey | undefined =>
    isYou(position)
      ? 'game.you'
      : input.players.find((p) => p.absolutePosition === position)?.username
        ? undefined
        : screenSeatKey(position, viewer);
  const ours = (team: TeamKey) => (yourTeam ? team === yourTeam : null);
  // "We" / "They" from your side; spectators see the table's sides.
  const sideKey = (team: TeamKey): TranslationKey =>
    yourTeam
      ? team === yourTeam
        ? 'game.we'
        : 'game.they'
      : team === 'north_south'
        ? 'game.ns_short'
        : 'game.ew_short';
  const side = (team: TeamKey) => t(sideKey(team));

  const handEntries = (
    hand: number,
    bids: ServerBid[] | null | undefined,
    trump: Suit | null | undefined,
    tricks: unknown,
    currentTrick: unknown,
    killed?: Partial<Record<Position, Card[]>> | null
  ): HandLogEntry[] => {
    const entries: HandLogEntry[] = [];
    for (const bid of Array.isArray(bids) ? bids : []) {
      if (!isPosition(bid?.position)) continue;
      const pass = bid.amount === 'pass';
      if (!pass && typeof bid.amount !== 'number') continue;
      entries.push({
        id: `bid-${hand}-${bid.position}`,
        kind: 'bid',
        ...say(
          name(bid.position),
          pass ? 'game.log_pass' : 'game.log_bid',
          { amount: bid.amount },
          nameKey(bid.position)
        ),
        ours: ours(teamOf(bid.position)),
        hand,
        trick: null,
      });
    }
    if (trump && SUIT_SYMBOLS[trump]) {
      entries.push({
        id: `trump-${hand}`,
        kind: 'trump',
        ...say(null, 'game.trump', { suit: SUIT_SYMBOLS[trump] }),
        ours: null,
        hand,
        trick: null,
      });
    }
    for (const position of ['north', 'east', 'south', 'west'] as const) {
      const cards = (Array.isArray(killed?.[position]) ? killed[position] : []).filter(
        (card) => typeof card?.rank === 'number'
      );
      if (!cards.length) continue;
      entries.push({
        id: `kill-${hand}-${position}`,
        kind: 'kill',
        ...say(
          name(position),
          'game.log_killed',
          {
            cards: [...cards]
              .sort((a, b) => b.rank - a.rank)
              .map(cardText)
              .join(' '),
          },
          nameKey(position)
        ),
        ours: ours(teamOf(position)),
        hand,
        trick: null,
      });
    }

    const addPlays = (plays: RawPlay[], trick: number) => {
      plays.forEach((play, index) => {
        const position = play?.player ?? play?.position;
        if (!isPosition(position) || !play.card) return;
        entries.push({
          id: `play-${hand}-${trick}-${index}`,
          kind: 'play',
          ...say(
            name(position),
            isYou(position) ? 'game.log_play_you' : 'game.log_play',
            { card: cardText(play.card) },
            nameKey(position)
          ),
          ours: ours(teamOf(position)),
          hand,
          trick,
        });
      });
    };

    const finished = (Array.isArray(tricks) ? tricks : []).filter(
      (trick) => playsOf(trick).length > 0
    );
    finished.forEach((raw, index) => {
      const trick = index + 1;
      addPlays(playsOf(raw), trick);
      const meta = raw as RawTrick;
      if (isPosition(meta.winner)) {
        const team = teamOf(meta.winner);
        const points = typeof meta.points === 'number' ? meta.points : 0;
        entries.push({
          id: `trick-${hand}-${trick}`,
          kind: 'trick',
          ...say(
            side(team),
            points > 0 ? 'game.log_take_points' : 'game.log_take',
            { points },
            sideKey(team)
          ),
          ours: ours(team),
          hand,
          trick,
        });
      }
      const two = meta.two_of_trump;
      if (two && isPosition(two.position) && typeof two.points === 'number') {
        entries.push({
          id: `two-${hand}-${trick}`,
          kind: 'two',
          ...say(
            name(two.position),
            isYou(two.position) ? 'game.log_two_you' : 'game.log_two',
            { points: two.points },
            nameKey(two.position)
          ),
          ours: ours(teamOf(two.position)),
          hand,
          trick,
        });
      }
    });
    addPlays(playsOf(currentTrick), finished.length + 1);
    return entries;
  };

  const resultEntry = (last: ServerLastHand): HandLogEntry => {
    const team = last.bidding_team;
    return {
      id: `result-${last.hand_number}`,
      kind: 'result',
      ...say(
        side(team),
        last.made ? 'game.log_made' : 'game.log_set',
        { delta: signed(last.delta?.[team] ?? 0) },
        sideKey(team)
      ),
      ours: ours(team),
      hand: last.hand_number,
      trick: null,
    };
  };

  const hand = input.handNumber ?? 0;
  const last = input.lastHand;
  const groups: HandLogGroup[] = [];
  const current = handEntries(
    hand,
    input.bids,
    input.trump,
    input.tricks,
    input.currentTrick,
    input.killed
  );

  if (last && last.hand_number < hand) {
    // The server has reset for the next hand; the last hand carries itself.
    groups.push({
      hand: last.hand_number,
      finished: true,
      entries: [
        ...handEntries(last.hand_number, last.bids, last.trump, last.tricks, null),
        resultEntry(last),
      ],
    });
  }
  const sameHandScored = !!last && last.hand_number === hand;
  if (current.length > 0 || sameHandScored) {
    groups.push({
      hand,
      finished: sameHandScored,
      // At game end there is no reset: the result closes the hand still on the table.
      entries: sameHandScored && last ? [...current, resultEntry(last)] : current,
    });
  }
  return groups;
}

export function handLogEntries(groups: HandLogGroup[]): HandLogEntry[] {
  return groups.flatMap((group) => group.entries);
}
