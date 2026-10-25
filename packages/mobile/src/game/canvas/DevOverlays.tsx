/**
 * DEV harness overlays — renders the M4 RN overlays over the Skia canvas with mock
 * data, selected by `?phase=` on /table-dev, so each overlay is screenshot-verifiable
 * over the blue felt without a live Phoenix game. Pure RN (no Skia import).
 * Throwaway scaffold.
 *   ?phase=playing|bidding|declaring|second_deal|game_over
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  Card,
  GameViewModel,
  RelativePlayerView,
  ServerGameState,
  ServerHandSummary,
  ServerLastHand,
  ServerPlayerView,
  Suit,
  TeamKey,
} from '@/types/game';
import type { Position } from '@/types/lobby';
import { useGameStore } from '@/stores/game';
import { ConnectionBanner } from '@/components/ui/ConnectionBanner';
import { BiddingActions } from '@/components/game/BiddingActions';
import { HandSelector } from '@/components/game/HandSelector';
import type { RematchVote } from '@pidro/shared';
import { GameOverOverlay } from '@/components/game/GameOverOverlay';
import { useTableReserves } from './TableChrome';
import { useTranslation } from '@/i18n';

const noop = () => {};

const vote = (agreed: Position[], you: Position, bots = false): RematchVote => {
  const seats = (['north', 'east', 'south', 'west'] as Position[]).map((position) => ({
    position,
    bot: bots && position !== you,
    agreed: (bots && position !== you) || agreed.includes(position),
  }));
  return {
    needed: bots ? 1 : 4,
    agreed: agreed.length,
    youAgreed: agreed.includes(you),
    seats,
  };
};

// `?rematch=` on the game-over fixture, seen from south: nobody has asked
// (`open`), Nora has (`one`), Nora and Eli have (`two`), the other three wait
// on you (`asked`), or you asked first (`waiting`).
const REMATCH_FIXTURES: Record<string, Position[]> = {
  open: [],
  one: ['north'],
  two: ['north', 'east'],
  asked: ['north', 'east', 'west'],
  waiting: ['south'],
};

const flip = (team: TeamKey): TeamKey => (team === 'north_south' ? 'east_west' : 'north_south');

// Ten hands, North/South winning 62–29 (Win-Reveal): level at 41 after hand 8,
// then East/West miss 12 and South bids 14 to finish. Hand 7 is East/West's
// best: Wynn bids 11 ♠, takes 12 of 14 and both Pidros.
const HANDS: [Position, number, Suit, number, number, number, number][] = [
  // bidder, bid, trump, N/S took, E/W took, N/S total, E/W total
  ['east', 7, 'clubs', 6, 8, 6, 8],
  ['north', 7, 'hearts', 8, 6, 14, 14],
  ['west', 8, 'spades', 8, 6, 22, 10],
  ['south', 8, 'diamonds', 8, 6, 30, 16],
  ['east', 9, 'hearts', 3, 11, 33, 27],
  ['north', 9, 'clubs', 12, 2, 45, 29],
  ['west', 11, 'spades', 2, 12, 47, 41],
  ['south', 6, 'diamonds', 5, 9, 41, 41],
  ['west', 12, 'hearts', 7, 7, 48, 29],
  ['south', 14, 'hearts', 14, 0, 62, 29],
];

// `?crew=win|loss`: Marcel's game in room JA36, you and Jocke against Marcel
// and Antti, all three bots. Seven hands to 62–36; hand 5 is your bid of 14
// and all 14 taken.
const CREW_HANDS: typeof HANDS = [
  ['east', 7, 'clubs', 5, 9, 5, 9],
  ['north', 8, 'hearts', 10, 4, 15, 13],
  ['west', 8, 'diamonds', 6, 8, 21, 21],
  ['south', 7, 'spades', 8, 6, 29, 27],
  ['south', 14, 'hearts', 14, 0, 43, 27],
  ['east', 7, 'clubs', 7, 7, 50, 34],
  ['north', 8, 'spades', 12, 2, 62, 36],
];

const sweep = (trump: Suit) =>
  [14, 11, 10, 2, 5, 5].map((rank, i) => ({
    card: {
      rank,
      suit:
        i === 5
          ? ({ hearts: 'diamonds', diamonds: 'hearts', clubs: 'spades', spades: 'clubs' } as const)[
              trump
            ]
          : trump,
    },
    points: rank === 5 ? 5 : 1,
  }));

export function handHistory(winner: TeamKey, crew = false): ServerHandSummary[] {
  let before = { north_south: 0, east_west: 0 };
  return (crew ? CREW_HANDS : HANDS).map(
    ([bidder, bid, trump, ns, ew, nsTotal, ewTotal], index) => {
      const swap = winner === 'east_west';
      const at = (position: Position): Position =>
        swap
          ? ({ north: 'east', east: 'south', south: 'west', west: 'north' } as const)[position]
          : position;
      const team = (key: TeamKey) => (swap ? flip(key) : key);
      const scores = {
        [team('north_south')]: nsTotal,
        [team('east_west')]: ewTotal,
      } as Record<TeamKey, number>;
      const biddingTeam = team(
        bidder === 'north' || bidder === 'south' ? 'north_south' : 'east_west'
      );
      const hand: ServerHandSummary = {
        hand_number: index + 1,
        bidding_team: biddingTeam,
        bidder: at(bidder),
        bid,
        captured: { [team('north_south')]: ns, [team('east_west')]: ew } as Record<TeamKey, number>,
        made: (biddingTeam === team('north_south') ? ns : ew) >= bid,
        delta: {
          north_south: scores.north_south - before.north_south,
          east_west: scores.east_west - before.east_west,
        },
        scores,
        trump,
        point_cards: crew
          ? index === 4
            ? sweep(trump).map((card) => ({
                ...card,
                position: at('south'),
                team: team('north_south'),
              }))
            : []
          : index === 6
            ? [
                {
                  card: { rank: 14, suit: 'spades' },
                  points: 1,
                  position: at('east'),
                  team: team('east_west'),
                },
                {
                  card: { rank: 5, suit: 'spades' },
                  points: 5,
                  position: at('west'),
                  team: team('east_west'),
                },
                {
                  card: { rank: 5, suit: 'clubs' },
                  points: 5,
                  position: at('east'),
                  team: team('east_west'),
                },
                {
                  card: { rank: 11, suit: 'spades' },
                  points: 1,
                  position: at('east'),
                  team: team('east_west'),
                },
                {
                  card: { rank: 2, suit: 'spades' },
                  points: 1,
                  position: at('north'),
                  team: team('north_south'),
                },
                {
                  card: { rank: 10, suit: 'spades' },
                  points: 1,
                  position: at('south'),
                  team: team('north_south'),
                },
              ]
            : index === 9
              ? sweep('hearts').map((card) => ({
                  ...card,
                  position: at('south'),
                  team: team('north_south'),
                }))
              : [],
      };
      before = scores;
      return hand;
    }
  );
}

function lastHand(winner: TeamKey, crew = false): ServerLastHand {
  const final = handHistory(winner, crew).at(-1)!;
  const by = final.bidder;
  const others = (['north', 'east', 'south', 'west'] as Position[]).filter((p) => p !== by);
  return {
    ...final,
    // The crew's last trick is a lone 5♠: everyone else was out of trumps.
    tricks: crew
      ? [{ winner: by, cards: [{ player: by, card: { rank: 5, suit: 'spades' } }] }]
      : [
          {
            winner: by,
            cards: [
              { player: others[0], card: { rank: 14, suit: 'hearts' } },
              { player: others[1], card: { rank: 2, suit: 'hearts' } },
              { player: by, card: { rank: 5, suit: 'hearts' } },
              { player: others[2], card: { rank: 9, suit: 'clubs' } },
            ],
          },
        ],
  };
}

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

const PLAYERS: RelativePlayerView[] = [
  seat('south', 'south', { username: 'You', isYou: true, isOpponent: false, isCurrentTurn: true }),
  seat('north', 'north', { username: 'Nora', isTeammate: true }),
  seat('east', 'east', { username: 'Eli' }),
  seat('west', 'west', { username: 'Wynn' }),
];

// The bot crew as the server seats it: a persona, no account.
const CREW: Partial<Record<Position, Partial<RelativePlayerView>>> = {
  north: { username: 'Jocke', bot_persona: 'jocke' },
  east: { username: 'Marcel', bot_persona: 'marcel' },
  west: { username: 'Antti', bot_persona: 'antti' },
};

const VM: GameViewModel = {
  roomCode: 'DEV01',
  phase: 'playing',
  viewerPositionAbsolute: 'south',
  trumpSuit: 'spades',
  dealerAbsolute: 'north',
  dealerRelative: 'north',
  currentTurnAbsolute: 'south',
  currentTurnRelative: 'south',
  players: PLAYERS,
};

const SERVER_PLAYERS: Record<Position, ServerPlayerView> = {
  north: { card_count: 9 },
  east: { card_count: 9 },
  south: { card_count: 9 },
  west: { card_count: 9 },
};

const SCORES = { north_south: 42, east_west: 31 };

const GAME_OVER_SERVER: ServerGameState = {
  phase: 'game_over',
  winner: 'north_south',
  current_player: null,
  players: SERVER_PLAYERS,
  scores: SCORES,
  round_number: 7,
};

const BIDDING_SERVER: ServerGameState = {
  phase: 'bidding',
  current_player: 'south',
  players: SERVER_PLAYERS,
  current_bid: 6,
  highest_bid: { position: 'north', amount: 6 },
  bids: { north: 6, east: 'pass', south: 7, west: 'pass' },
  scores: { north_south: 0, east_west: 0 },
  round_number: 1,
};

const HAND12: Card[] = [
  { suit: 'spades', rank: 14 },
  { suit: 'spades', rank: 11 },
  { suit: 'spades', rank: 5 },
  { suit: 'spades', rank: 2 },
  { suit: 'hearts', rank: 13 },
  { suit: 'hearts', rank: 10 },
  { suit: 'hearts', rank: 5 },
  { suit: 'diamonds', rank: 14 },
  { suit: 'diamonds', rank: 9 },
  { suit: 'clubs', rank: 12 },
  { suit: 'clubs', rank: 7 },
  { suit: 'clubs', rank: 3 },
];

export function DevOverlays({
  phase,
  isHandReady,
  canPass = true,
  rematch,
  result,
  xp,
  playerName,
  guest = false,
  crew,
}: {
  phase: string;
  isHandReady: boolean;
  canPass?: boolean;
  rematch?: string;
  result?: string;
  xp?: string;
  playerName?: string;
  guest?: boolean;
  crew?: 'win' | 'loss';
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [voted, setVoted] = useState(false);
  const insets = useSafeAreaInsets();
  const { topReserve, bottomReserve } = useTableReserves();
  const eastViewer = result === 'east';
  const spectator = result === 'spectator';
  const viewer: Position = eastViewer ? 'east' : 'south';
  const asked = REMATCH_FIXTURES[rematch ?? 'open'] ?? null;
  const resultModel: GameViewModel = {
    ...VM,
    viewerPositionAbsolute: eastViewer ? 'east' : 'south',
    players: PLAYERS.map((player) => ({
      ...player,
      username:
        player.absolutePosition === 'south'
          ? 'Alex'
          : player.absolutePosition === 'north' && playerName
            ? playerName
            : player.username,
      ...(crew && CREW[player.absolutePosition]
        ? { ...CREW[player.absolutePosition], playerId: null, seatStatus: 'permanent_bot' as const }
        : null),
      isYou: !spectator && player.absolutePosition === (eastViewer ? 'east' : 'south'),
    })),
  };
  const winner: TeamKey =
    result === 'loss' || crew === 'loss' || eastViewer ? 'east_west' : 'north_south';
  const history = handHistory(winner, !!crew);
  const resultState: ServerGameState = {
    ...GAME_OVER_SERVER,
    winner: result === 'tie' ? null : winner,
    scores:
      result === 'tie'
        ? { north_south: 62, east_west: 62 }
        : (history.at(-1)!.scores as ServerGameState['scores']),
    hand_history: result === 'tie' ? [] : history,
    last_hand: result === 'tie' ? null : lastHand(winner, !!crew),
  };
  const won = result !== 'tie' && result !== 'loss' && result !== 'spectator' && crew !== 'loss';

  // Seed the store so the store-driven BiddingActions shows in dev (no Phoenix).
  useEffect(() => {
    if (phase !== 'bidding') return;
    const prev = useGameStore.getState();
    // Realistic legal set: every raise above the current bid (6) up to 14.
    useGameStore.setState({
      serverState: BIDDING_SERVER,
      legalActions: [
        ...([7, 8, 9, 10, 11, 12, 13, 14] as const).map(
          (amount) => ({ type: 'bid', amount }) as const
        ),
        ...(canPass ? ([{ type: 'pass' }] as const) : []),
      ],
    });
    return () =>
      useGameStore.setState({ serverState: prev.serverState, legalActions: prev.legalActions });
  }, [canPass, phase]);

  return (
    <>
      {/* Scoreboard lives on the canvas now; just the connection banner floats here. */}
      <View style={[styles.topStack, { paddingTop: insets.top }]} pointerEvents="box-none">
        <ConnectionBanner isConnected />
      </View>

      {phase === 'bidding' && (
        <BiddingActions
          isYourTurn
          isHandReady={isHandReady}
          topReserve={topReserve}
          bottomReserve={bottomReserve}
        />
      )}

      {phase === 'second_deal' && (
        <View
          style={[
            styles.centerOverlay,
            { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 16 },
          ]}
          pointerEvents="box-none">
          <HandSelector viewModel={VM} cards={HAND12} trumpSuit="spades" onSelectHand={noop} />
        </View>
      )}

      {phase === 'game_over' && (
        <GameOverOverlay
          viewModel={resultModel}
          serverState={resultState}
          onHome={() => router.replace('/home')}
          onPlayAgain={() => setVoted(true)}
          rematch={asked && vote(voted ? [...asked, viewer] : asked, viewer, !!crew)}
          rematchPending={rematch === 'pending'}
          playAgainLabel={guest ? t('game.play_again') : undefined}
          guest={guest}
          showGuestSave={guest}
          onSaveGuest={() => {}}
          progressionSummary={
            xp
              ? {
                  xp_earned: won ? 126 : 76,
                  veteran_level: 12,
                  leveled_up: xp === 'level',
                  veteran_progress: { into: 52, span: 100, max: false },
                  partner: {
                    user_id: 'p-north',
                    display_name: playerName ?? 'Nora',
                    games_together: 5,
                    wins_in_a_row: won ? 3 : 0,
                  },
                }
              : null
          }
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  topStack: { position: 'absolute', top: 0, left: 0, right: 0, gap: 8 },
  centerOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
