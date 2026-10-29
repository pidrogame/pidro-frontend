/**
 * DEV harness — renders the Skia table with a mock model + real card textures and
 * a LOCAL fake server so M2/M3 are provable on web without Phoenix. It exercises:
 *   mount → deal-in (stagger) → trump declared (glyph pop) → you play (fly to trick)
 *   → opponents follow (fly from seats) → trick completes and remains on the table.
 * The turn halo pulses on the active seat throughout.
 * Throwaway scaffold.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GameCanvas from './GameCanvas';
import { SeatLayer, type SeatTurn } from './SeatLayer';
import type { SeatLine } from '@/features/game/seatLine';
import { TableSignals, scoreGlow, tablePidro } from './TableSignals';
import { HandResultPanel, useHandResult, viewerOf } from './HandResult';
import { Scoreboard } from './Scoreboard';
import { handHistory } from './DevOverlays';
import { TableSettings } from './TableSettings';
import { TableChromeBars, headerTop, useTableReserves, useTableSize } from './TableChrome';
import { computeLayout, tickerPlacement } from './layout';
import { useCardTextures } from './cardTextures';
import { buildTableModel } from './tableModel';
import { usePlayPresentation } from './usePlayPresentation';
import { buildHandLog } from '@/game/handLog';
import { useHandPresentationReady } from './useHandPresentationReady';
import { getRankLabel, SUIT_SYMBOLS } from '@/utils/cards';
import { PidroSpacing } from '@/design/tokens';
import { PidroText } from '@/components/ui/PidroText';
import type {
  ActiveTurnTimer,
  Card,
  GamePhase,
  LegalAction,
  RelativePlayerView,
  RelativePosition,
  ServerBid,
  ServerLastHand,
  ServerPointCard,
  Suit,
  SeatStatus,
} from '@/types/game';
import type { Position } from '@/types/lobby';
import { t, useTranslation } from '@/i18n';

const seat = (
  abs: Position,
  rel: RelativePlayerView['relativePosition'],
  extra: Partial<RelativePlayerView>
): RelativePlayerView => ({
  absolutePosition: abs,
  relativePosition: rel,
  playerId: `p-${abs}`,
  username: extra.username ?? abs,
  isYou: false,
  isTeammate: false,
  isOpponent: true,
  isConnected: true,
  isCurrentTurn: false,
  seatStatus: 'normal',
  ...extra,
});

/** `lifecycle=permanent_bot`: the bot crew, seated as a quick game seats them. */
const CREW_SEATS: Partial<Record<Position, Pick<RelativePlayerView, 'username' | 'bot_persona'>>> =
  {
    west: { username: 'Marcel', bot_persona: 'marcel' },
    north: { username: 'Antti', bot_persona: 'antti' },
    east: { username: 'Jocke', bot_persona: 'jocke' },
  };

/** `bots=dynamic|image-failure`: fourth opaque persona with snapshot metadata. */
const FOURTH_BOT = {
  id: '1c477a6a-fb56-4b4f-a6b5-3b1390c60102',
  name: 'Saga',
  description: 'A new member of the table crew.',
  avatar_url: 'https://fixture.invalid/images/bots/antti.svg',
};

/** `names=long`: Classic-length usernames, the longest a seat label has to carry. */
const LONG_NAMES: Record<Position, string> = {
  south: 'ThunderThor88',
  north: 'Pikkupossu123',
  east: 'MaijaLiisa_K',
  west: 'KaleviVirtanen',
};
/** `names=max`: a 32-character name in every seat, past what any label can carry. */
const MAX_NAME = 'Alexandria the Long-Named Player';
const SEATS: RelativePosition[] = ['north', 'east', 'south', 'west'];

const basePlayers = (turn: RelativePosition): RelativePlayerView[] => [
  seat('south', 'south', {
    username: 'You',
    isYou: true,
    isOpponent: false,
    isCurrentTurn: turn === 'south',
    level: 44,
    pin: 'classic',
  }),
  seat('north', 'north', {
    username: 'Nora',
    isTeammate: true,
    isCurrentTurn: turn === 'north',
    level: 31,
  }),
  seat('east', 'east', { username: 'Eli', isCurrentTurn: turn === 'east', level: 12 }),
  seat('west', 'west', {
    username: 'Wynn',
    isCurrentTurn: turn === 'west',
    level: 18,
    pin: 'classic',
  }),
];

const INITIAL_HAND: Card[] = [
  { suit: 'spades', rank: 14 },
  { suit: 'spades', rank: 7 },
  { suit: 'hearts', rank: 13 },
  { suit: 'diamonds', rank: 11 },
  { suit: 'clubs', rank: 12 },
  { suit: 'hearts', rank: 2 },
];

// Demo cards the opponents "play" to complete a trick.
const OPP_PLAYS: { player: Position; card: Card }[] = [
  { player: 'west', card: { suit: 'diamonds', rank: 5 } },
  { player: 'north', card: { suit: 'clubs', rank: 7 } },
  { player: 'east', card: { suit: 'hearts', rank: 4 } },
];

// `signals=pidro`: North drops the 5 of trump on your ace, so the trick is a "Pidro!".
const OPP_PLAYS_PIDRO: { player: Position; card: Card }[] = [
  { player: 'west', card: { suit: 'diamonds', rank: 5 } },
  { player: 'north', card: { suit: 'spades', rank: 5 } },
  { player: 'east', card: { suit: 'hearts', rank: 4 } },
];

// `signals=pidro-theirs`: you play the 7 of trump, West tops it with the king
// and East drops the 5 on it, so the Pidro is theirs.
const OPP_PLAYS_THEIR_PIDRO: { player: Position; card: Card }[] = [
  { player: 'west', card: { suit: 'spades', rank: 13 } },
  { player: 'north', card: { suit: 'hearts', rank: 4 } },
  { player: 'east', card: { suit: 'spades', rank: 5 } },
];

// `signals=points`: your ace takes a point and North keeps the 2 of trump's.
const OPP_PLAYS_POINTS: { player: Position; card: Card }[] = [
  { player: 'west', card: { suit: 'diamonds', rank: 5 } },
  { player: 'north', card: { suit: 'spades', rank: 2 } },
  { player: 'east', card: { suit: 'hearts', rank: 4 } },
];

// `signals=points-theirs`: West's jack takes your 7 for a point and East keeps the 2's.
const OPP_PLAYS_THEIR_POINTS: { player: Position; card: Card }[] = [
  { player: 'west', card: { suit: 'spades', rank: 11 } },
  { player: 'north', card: { suit: 'hearts', rank: 4 } },
  { player: 'east', card: { suit: 'spades', rank: 2 } },
];

/** Which of your cards autoplay leads, and how the others answer, per `signals=`. */
const SIGNAL_TRICKS: Record<string, { lead: number; plays: { player: Position; card: Card }[] }> = {
  pidro: { lead: 0, plays: OPP_PLAYS_PIDRO },
  'pidro-theirs': { lead: 1, plays: OPP_PLAYS_THEIR_PIDRO },
  points: { lead: 0, plays: OPP_PLAYS_POINTS },
  'points-theirs': { lead: 1, plays: OPP_PLAYS_THEIR_POINTS },
};

/**
 * The fake server's trick signals (PID-218 shape). Fixture-only: the real
 * table gets winner and points from the server and never computes them.
 */
const fixturePoints = (card: Card) =>
  card.suit !== 'spades' ? 0 : card.rank === 5 ? 5 : [14, 11, 10].includes(card.rank) ? 1 : 0;
function fixtureSignals(plays: Play[]) {
  const trumps = plays.filter((play) => play.card.suit === 'spades');
  const best = trumps.reduce<Play | null>(
    (top, play) => (!top || play.card.rank > top.card.rank ? play : top),
    null
  );
  const lead = best ?? plays[0] ?? null;
  const two = trumps.find((play) => play.card.rank === 2);
  return {
    winning: lead ? { position: lead.player, card: lead.card } : null,
    points: plays.reduce((sum, play) => sum + fixturePoints(play.card), 0),
    two_of_trump: two ? { position: two.player, points: 1 } : null,
  };
}

/** A card that scored, kept by `position`'s team. */
const scored = (rank: number, suit: Suit, points: number, position: Position) =>
  ({
    card: { rank, suit },
    points,
    position,
    team: position === 'north' || position === 'south' ? 'north_south' : 'east_west',
  }) satisfies ServerPointCard;

/** `hand=`: the hand before this one, as the server scored it (PID-233's `point_cards`). */
const FIXTURE_HANDS = {
  made: {
    hand_number: 4,
    bidding_team: 'north_south',
    bidder: 'south',
    bid: 8,
    trump: 'spades',
    captured: { north_south: 9, east_west: 5 },
    made: true,
    delta: { north_south: 9, east_west: 5 },
    scores: { north_south: 45, east_west: 34 },
    point_cards: [
      scored(14, 'spades', 1, 'south'),
      scored(11, 'spades', 1, 'north'),
      scored(5, 'clubs', 5, 'east'),
      scored(5, 'spades', 5, 'north'),
      scored(10, 'spades', 1, 'south'),
      scored(2, 'spades', 1, 'south'),
    ],
  },
  set: {
    hand_number: 4,
    bidding_team: 'north_south',
    bidder: 'south',
    bid: 10,
    trump: 'spades',
    captured: { north_south: 7, east_west: 7 },
    made: false,
    delta: { north_south: -10, east_west: 7 },
    scores: { north_south: 26, east_west: 36 },
    point_cards: [
      scored(5, 'spades', 5, 'south'),
      scored(11, 'spades', 1, 'west'),
      scored(14, 'spades', 1, 'north'),
      scored(5, 'clubs', 5, 'east'),
      scored(10, 'spades', 1, 'west'),
      scored(2, 'spades', 1, 'south'),
    ],
  },
  // East bids 9 and misses; Nora takes the 5 of trump on the way.
  'they-set': {
    hand_number: 4,
    bidding_team: 'east_west',
    bidder: 'east',
    bid: 9,
    trump: 'spades',
    captured: { north_south: 8, east_west: 6 },
    made: false,
    delta: { north_south: 8, east_west: -9 },
    scores: { north_south: 44, east_west: 20 },
    point_cards: [
      scored(5, 'clubs', 5, 'east'),
      scored(5, 'spades', 5, 'north'),
      scored(14, 'spades', 1, 'south'),
      scored(10, 'spades', 1, 'west'),
      scored(11, 'spades', 1, 'north'),
      scored(2, 'spades', 1, 'south'),
    ],
  },
} satisfies Record<string, ServerLastHand>;
// JA36, hand 5: Jocke bid 10 in hearts and our team captured all six point cards.
const JA36_HAND: ServerLastHand = {
  hand_number: 5,
  bidding_team: 'north_south',
  bidder: 'north',
  bid: 10,
  trump: 'hearts',
  captured: { north_south: 14, east_west: 0 },
  made: true,
  delta: { north_south: 14, east_west: 0 },
  scores: { north_south: 50, east_west: 29 },
  point_cards: [
    scored(14, 'hearts', 1, 'north'),
    scored(2, 'hearts', 1, 'south'),
    scored(10, 'hearts', 1, 'north'),
    scored(11, 'hearts', 1, 'south'),
    scored(5, 'diamonds', 5, 'north'),
    scored(5, 'hearts', 5, 'south'),
  ],
};
const fixtureHand = (name: string | undefined) =>
  name === 'own'
    ? FIXTURE_HANDS.made
    : name === 'own-missed'
      ? FIXTURE_HANDS.set
      : name === 'all-14'
        ? JA36_HAND
        : name === 'all-14-theirs'
          ? {
              ...JA36_HAND,
              bidding_team: 'east_west' as const,
              bidder: 'east' as const,
              captured: { north_south: 0, east_west: 14 },
              delta: { north_south: 0, east_west: 14 },
              scores: { north_south: 36, east_west: 43 },
              point_cards: JA36_HAND.point_cards?.map((point) => ({
                ...point,
                team: 'east_west' as const,
                position: 'east' as const,
              })),
            }
          : name && name in FIXTURE_HANDS
            ? FIXTURE_HANDS[name as keyof typeof FIXTURE_HANDS]
            : null;

/** The bidding behind the seats' "Passed" / "Bid 6", in order from the dealer's left. */
const FIXTURE_BIDS: ServerBid[] = [
  { position: 'west', amount: 'pass' },
  { position: 'north', amount: 'pass' },
  { position: 'east', amount: 6 },
  { position: 'south', amount: 'pass' },
];

const DEALER_CUTS: Record<Position, Card> = {
  north: { suit: 'clubs', rank: 9 },
  east: { suit: 'spades', rank: 14 },
  south: { suit: 'hearts', rank: 5 },
  west: { suit: 'diamonds', rank: 7 },
};
const dealerCutStatus = () =>
  Object.fromEntries(
    Object.entries(DEALER_CUTS).map(([position, card]) => [
      position,
      { text: t('game.draws', { card: `${getRankLabel(card.rank)}${SUIT_SYMBOLS[card.suit]}` }) },
    ])
  ) as Record<RelativePosition, SeatLine>;

const COUNTS: Record<string, number> = { south: 6, north: 8, east: 8, west: 7 };
type Play = { player: Position; card: Card };
const sameCard = (a: Card, b: Card) => a.suit === b.suit && a.rank === b.rank;

/** `timer=running`: the seat on turn gets a 20 s turn timer that restarts with each turn. */
const FIXTURE_TURN_MS = 20_000;
function useFixtureTurnTimer(
  running: boolean,
  turn: RelativePosition
): Partial<Record<RelativePosition, SeatTurn>> | undefined {
  // As at the real table: the arc runs down by itself; the seats wake to turn urgent.
  const [clock, setClock] = useState<{ turn: RelativePosition; endsAt: number; urgent: boolean }>();
  useEffect(() => {
    if (!running) return;
    const endsAt = Date.now() + FIXTURE_TURN_MS;
    const ids = [
      setTimeout(() => setClock({ turn, endsAt, urgent: false }), 0),
      setTimeout(() => setClock({ turn, endsAt, urgent: true }), FIXTURE_TURN_MS * 0.75),
    ];
    return () => ids.forEach(clearTimeout);
  }, [running, turn]);
  if (!running) return undefined;
  const live = clock?.turn === turn ? clock : null;
  return {
    [turn]: {
      progress: 1,
      urgent: live?.urgent ?? false,
      endsAt: live?.endsAt,
      durationMs: FIXTURE_TURN_MS,
    },
  };
}

export type GameCanvasDevProps = {
  onHandPresentationReadyChange?: (ready: boolean) => void;
  autoPlay?: boolean;
  phase?: GamePhase;
  lifecycle?: SeatStatus;
};

export default function GameCanvasDev({
  onHandPresentationReadyChange,
  autoPlay = false,
  phase = 'playing',
  lifecycle,
}: GameCanvasDevProps) {
  const { bots } = useLocalSearchParams<{ bots?: string }>();
  const { locale } = useTranslation();
  const textures = useCardTextures();
  const insets = useSafeAreaInsets();
  const { width, height } = useTableSize();
  const reserves = useTableReserves();
  const { topReserve, bottomReserve } = reserves;
  const layout = computeLayout(width, height, insets, topReserve, bottomReserve);
  const [hand, setHand] = useState<Card[]>([]);
  const [trick, setTrick] = useState<Play[]>([]);
  const [tricks, setTricks] = useState<
    {
      cards: Play[];
      winner: Position | undefined;
      points: number;
      two_of_trump: { position: Position; points: number } | null;
    }[]
  >([]);
  const [trump, setTrump] = useState<Suit | null>(null);
  const [turn, setTurn] = useState<RelativePosition>('south');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playing = useRef(false);
  const {
    scores: scoreFixture,
    dealer: dealerFixture,
    names,
    timer,
    signals,
    hand: handParam,
    ticker,
    count,
    fixture,
    play,
    reply,
    sweep,
    autoplay,
    transition,
    menu,
    solo,
    viewer,
  } = useLocalSearchParams<{
    scores?: string;
    dealer?: string;
    names?: string;
    timer?: string;
    signals?: string;
    hand?: string;
    ticker?: string;
    count?: string;
    fixture?: string;
    play?: string;
    reply?: string;
    sweep?: RelativePosition;
    autoplay?: string;
    transition?: string;
    menu?: string;
    solo?: string;
    viewer?: string;
  }>();
  const handFixture = fixture?.startsWith('all-14') ? fixture : handParam;
  const ownPace = handParam === 'own' || handParam === 'own-missed';
  const motionFixture = fixture === 'play-motion';
  const transitionMs =
    transition === '0' ? 0 : transition === '80' ? 80 : transition === '3000' ? 3000 : 1500;
  const [cycle, setCycle] = useState(0);
  const [transitionTimer, setTransitionTimer] = useState<ActiveTurnTimer | null>(null);
  // `ticker=full`: three bids land after the table opens, so the ticker fills.
  const [bids, setBids] = useState<ServerBid[]>(
    ticker === 'full' ? FIXTURE_BIDS.slice(0, 1) : FIXTURE_BIDS
  );
  useEffect(() => {
    if (ticker !== 'full') return;
    const landed = setTimeout(() => setBids(FIXTURE_BIDS), 300);
    return () => clearTimeout(landed);
  }, [ticker]);
  const dealer = SEATS.find((rel) => rel === dealerFixture) ?? ('south' satisfies RelativePosition);
  const turnTimer = useFixtureTurnTimer(timer === 'running', turn);
  const [scores, setScores] = useState(
    scoreFixture === 'history'
      ? { north_south: 48, east_west: 29 }
      : { north_south: 36, east_west: 29 }
  );

  const [lastHand, setLastHand] = useState<ServerLastHand | null>(null);
  const [continued, setContinued] = useState(false);
  const [continueAttempts, setContinueAttempts] = useState(0);
  useEffect(() => {
    const fixture = fixtureHand(handFixture);
    if (!fixture) return;
    const shown = setTimeout(() => {
      setLastHand(fixture);
      setScores(fixture.scores);
    }, 1600);
    return () => clearTimeout(shown);
  }, [handFixture]);
  const after = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  // Deal on mount, then declare trump (glyph pop).
  useEffect(() => {
    if (phase === 'dealer_selection') return;
    after(450, () => setHand(INITIAL_HAND));
    after(1300, () => setTrump('spades'));
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, [after, phase]);

  // Fake server: legal = trumps (spades) + K♥ still in hand → others stay dimmed.
  const legalActions = useMemo<LegalAction[]>(
    () =>
      hand
        .filter(
          (c) => motionFixture || c.suit === 'spades' || (c.suit === 'hearts' && c.rank === 13)
        )
        .map((c) => ({ type: 'play_card', card: c })),
    [hand, motionFixture]
  );

  const onPlayCard = useCallback(
    (card: Card) => {
      if (playing.current) return false;
      playing.current = true;
      if (motionFixture) {
        const reset = () => {
          playing.current = false;
          setHand(INITIAL_HAND);
          setTrick([]);
          setTricks([]);
          setTurn('south');
          setTransitionTimer(null);
          setCycle((value) => value + 1);
        };
        if (reply === 'reject' || reply === 'early-reject' || reply === 'timeout') {
          after(6500, reset);
          return new Promise<boolean>((resolve) => {
            if (reply !== 'timeout')
              after(reply === 'early-reject' ? 80 : 800, () => resolve(false));
          });
        }
        const delay = reply === 'fast' ? 80 : reply === 'late' ? 5400 : 800;
        const gap = reply === 'burst' ? 80 : 700;
        const plays = [{ player: 'south' as Position, card }, ...OPP_PLAYS];
        after(delay, () => {
          setHand((h) => h.filter((c) => !sameCard(c, card)));
          setTrick(plays.slice(0, 1));
          setTurn('west');
        });
        after(delay + gap, () => {
          setTrick(plays.slice(0, 2));
          setTurn('north');
        });
        after(delay + gap * 2, () => {
          setTrick(plays.slice(0, 3));
          setTurn('east');
        });
        after(delay + 2100, () => {
          setTrick([]);
          setTricks([
            { cards: plays, winner: sweep ?? SEATS[cycle % 4], points: 1, two_of_trump: null },
          ]);
          // The winner went cold: the server skips it, then broadcasts a new timer.
          setTurn('south');
        });
        after(delay + 2150, () => setTransitionTimer(null));
        after(delay + 2200, () => {
          setTransitionTimer({
            timerId: cycle + 1,
            scope: 'seat',
            position: 'south',
            phase: 'playing',
            durationMs: 20_000,
            remainingMs: 20_000 + Math.max(0, transitionMs - 100),
            transitionDelayMs: transitionMs,
            receivedAtMs: Date.now(),
            serverTime: new Date().toISOString(),
            eventSeq: cycle + 1,
          });
        });
        if (autoplay !== 'false') after(delay + 3100 + transitionMs, reset);
        return Promise.resolve(true);
      }
      const trickCards = [
        { player: 'south' as Position, card },
        ...(SIGNAL_TRICKS[signals ?? '']?.plays ?? OPP_PLAYS),
      ];
      setHand((h) => h.filter((c) => !sameCard(c, card)));
      setTurn('east');
      setTrick([trickCards[0]]);
      // opponents follow, flying in from their seats
      after(550, () => setTrick(trickCards.slice(0, 2)));
      after(1100, () => setTrick(trickCards.slice(0, 3)));
      after(1650, () => setTrick(trickCards));
      // Trick completes → cards stay on table as round history.
      after(2450, () => {
        const { winning, points, two_of_trump } = fixtureSignals(trickCards);
        setTricks((t) => [
          ...t,
          { cards: trickCards, winner: winning?.position, points, two_of_trump },
        ]);
        setTrick([]);
        setTurn('north');
      });
    },
    [after, signals, motionFixture, reply, sweep, cycle, autoplay, transitionMs]
  );

  const players = useMemo(
    () =>
      basePlayers(turn)
        .map((player) => ({
          ...player,
          isYou: viewer === 'spectator' ? false : player.isYou,
          username:
            fixture?.startsWith('all-14') &&
            player.absolutePosition === (fixture === 'all-14-theirs' ? 'east' : 'north')
              ? 'Jocke'
              : player.username,
        }))
        .map((player) =>
          names === 'long'
            ? { ...player, username: LONG_NAMES[player.absolutePosition] }
            : names === 'max'
              ? { ...player, username: MAX_NAME }
              : player
        )
        .map((player) =>
          player.isYou || !lifecycle
            ? player
            : lifecycle === 'permanent_bot'
              ? {
                  ...player,
                  seatStatus: lifecycle,
                  ...CREW_SEATS[player.absolutePosition],
                  ...((bots === 'dynamic' || bots === 'image-failure') &&
                  player.absolutePosition === 'east'
                    ? {
                        username: FOURTH_BOT.name,
                        bot_persona: FOURTH_BOT.id,
                        bot_profile: {
                          ...FOURTH_BOT,
                          avatar_url:
                            bots === 'image-failure'
                              ? 'https://fixture.invalid/api/v1/bots/saga/avatar/missing'
                              : FOURTH_BOT.avatar_url,
                        },
                      }
                    : {}),
                }
              : {
                  ...player,
                  seatStatus: lifecycle,
                  username: lifecycle === 'vacant' ? t('game.open_seat') : player.username,
                }
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locale invalidates synthetic seat names
    [turn, lifecycle, names, locale, bots, fixture, viewer]
  );
  const canPlay = turn === 'south' && hand.length > 0 && !trick.some((p) => p.player === 'south');

  const serverModel = useMemo(
    () =>
      buildTableModel({
        phase,
        transitionDelayMs: transitionMs,
        trumpSuit: trump,
        dealerRelative: phase === 'dealer_selection' ? 'east' : dealer,
        players,
        yourHand: hand,
        yourCardCount: hand.length,
        dealerSelectionCuts: phase === 'dealer_selection' ? DEALER_CUTS : null,
        currentTrick: trick,
        tricks,
        trickDetails: trick.length ? fixtureSignals(trick) : null,
        lastHand,
        legalActions,
        currentTurnRelative: turn,
        canPlay,
        getCardCountForPlayer: (abs) => (abs ? (COUNTS[abs] ?? null) : null),
        // `count=on`: "Help me keep count": the log, the points as tricks are
        // taken, and the card winning the trick, as at the real table.
        countHelp: count === 'on',
      }),
    [
      phase,
      transitionMs,
      hand,
      trick,
      tricks,
      legalActions,
      trump,
      players,
      turn,
      canPlay,
      dealer,
      lastHand,
      count,
    ]
  );
  const presentation = usePlayPresentation(serverModel, onPlayCard, transitionTimer);
  const model = motionFixture ? presentation.model : serverModel;
  const playCard = motionFixture ? presentation.playCard : onPlayCard;
  const isHandReady = useHandPresentationReady(model.yourHand, textures);
  // Own pace keeps the completed hand's number until Continue deals again.
  const handNumber = (lastHand?.hand_number ?? 4) + (lastHand && (!ownPace || continued) ? 1 : 0);
  const handResult = useHandResult(
    lastHand,
    viewerOf(model.seats),
    'TABLE-DEV',
    ownPace && !!lastHand && !continued
  );
  const handLog = useMemo(
    () =>
      buildHandLog({
        handNumber,
        bids,
        trump,
        tricks,
        currentTrick: trick,
        lastHand,
        players,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildHandLog translates through the stable global t
    [handNumber, bids, trump, tricks, trick, lastHand, players, locale]
  );

  const countHelp = count === 'on';
  const pidro = countHelp ? tablePidro(model.lastTrick, model.seats) : null;
  const trickKey = `${handNumber}:${model.lastTrick?.number}`;

  useEffect(() => {
    onHandPresentationReadyChange?.(isHandReady);
  }, [isHandReady, onHandPresentationReadyChange]);

  useEffect(() => {
    if (motionFixture || !autoPlay || phase !== 'playing' || !isHandReady) return;
    const id = setTimeout(
      () => onPlayCard(INITIAL_HAND[SIGNAL_TRICKS[signals ?? '']?.lead ?? 0]),
      0
    );
    return () => clearTimeout(id);
  }, [motionFixture, autoPlay, isHandReady, onPlayCard, phase, signals]);

  useEffect(() => {
    if (!motionFixture || autoplay === 'false' || !isHandReady || playing.current) return;
    const position = play ?? ['right', 'left', 'middle'][cycle % 3];
    const cards = serverModel.yourHand;
    const card =
      cards[
        position === 'right'
          ? cards.length - 1
          : position === 'left'
            ? 0
            : Math.floor(cards.length / 2)
      ];
    if (!card) return;
    const id = setTimeout(() => playCard(card.card), 1200);
    return () => clearTimeout(id);
  }, [motionFixture, autoplay, isHandReady, cycle, play, serverModel.yourHand, playCard]);

  return (
    <View style={{ flex: 1 }}>
      {motionFixture ? (
        <View
          testID="play-fixture"
          pointerEvents="none"
          accessibilityLabel={JSON.stringify({
            cycle,
            hand: hand.length,
            turn,
            completed: tricks.length,
          })}
        />
      ) : null}
      <GameCanvas
        model={
          handResult.result?.waiting
            ? { ...model, yourHand: [], currentTrick: {}, playedCards: {} }
            : model
        }
        textures={textures}
        onPlayCard={playCard}
        topReserve={topReserve}
        bottomReserve={bottomReserve}
      />
      {countHelp ? (
        <TableSignals model={model} topReserve={topReserve} bottomReserve={bottomReserve} />
      ) : null}
      <SeatLayer
        turnByRel={turnTimer}
        seats={model.seats}
        dealerRel={phase === 'dealer_selection' ? null : dealer}
        topReserve={topReserve}
        bottomReserve={bottomReserve}
        quiet={handResult.result != null}
        statusByRel={
          phase === 'dealer_selection'
            ? dealerCutStatus()
            : {
                north: { text: t('game.passed'), tone: 'quiet' },
                east: { text: t('game.bid', { amount: 6 }) },
                west: { text: t('game.passed'), tone: 'quiet' },
                [turn]: { text: t('game.playing'), tone: 'now' },
                ...(pidro?.side === 'theirs'
                  ? { [pidro.seat]: { text: t('game.took_trick'), pulse: `pidro-${trickKey}` } }
                  : null),
              }
        }
      />
      <TableChromeBars reserves={reserves} />
      {handResult.result ? (
        <HandResultPanel
          key={handResult.result.hand.hand_number}
          result={handResult.result}
          seats={model.seats}
          onClose={handResult.close}
          onContinue={
            viewer === 'spectator'
              ? undefined
              : async () => {
                  if (reply === 'continue') {
                    setContinueAttempts((n) => n + 1);
                    await new Promise((resolve) => after(350, () => resolve(undefined)));
                    if (continueAttempts === 0) return false;
                    // Acknowledge before broadcasting the next state.
                    after(800, () => setContinued(true));
                    return true;
                  }
                  setContinued(true);
                  return true;
                }
          }
          topReserve={topReserve}
          bottomReserve={bottomReserve}
        />
      ) : null}
      {reply === 'continue' ? (
        <PidroText testID="continue-attempts" style={{ position: 'absolute', bottom: 0 }}>
          {continueAttempts}
        </PidroText>
      ) : null}
      {phase !== 'game_over' && (
        <>
          <Scoreboard
            scores={scores}
            youPosition="south"
            history={
              scoreFixture === 'history' || fixture === 'scores'
                ? handHistory('north_south').slice(0, 9)
                : lastHand
                  ? [lastHand]
                  : []
            }
            roomCode="DEV01"
            glow={countHelp ? scoreGlow(model.lastTrick, model.seats, trickKey) : null}
            delta={handResult.result?.hand.delta ?? null}
            top={headerTop(insets.top)}
            left={insets.left}
            log={handLog}
            // East's "Bid 6" from the fixture's bidding, held through the play.
            resting={
              phase === 'playing'
                ? { who: 'Eli', what: t('game.bid', { amount: 6 }), ours: false }
                : null
            }
            logInPanel={countHelp && layout.tight}
            ticker={
              countHelp
                ? tickerPlacement(
                    layout,
                    {
                      tableTop: insets.top + topReserve,
                      plaqueLeft: insets.left + PidroSpacing.sm,
                      plaqueTop: headerTop(insets.top),
                    },
                    true
                  )
                : null
            }
          />
          <TableSettings
            onLeave={() => {}}
            onRules={menu === 'pace' ? () => {} : undefined}
            initiallyOpen={menu === 'pace'}
            isSolo={solo === 'true'}
          />
        </>
      )}
    </View>
  );
}
