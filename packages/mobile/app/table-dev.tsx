/**
 * DEV HARNESS — open at /table-dev. Renders the Skia table (M1–M3) behind the M4 RN
 * overlays. `?phase=waiting|playing|bidding|declaring|second_deal|game_over` picks which
 * overlay to show with mock data. Native renders directly; web lazy-loads CanvasKit.
 * DevOverlays is pure RN (no Skia) so it's safe to import statically. Throwaway.
 */
import { useEffect, useState, type ComponentType } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FixtureInsets } from '@/components/dev/FixtureInsets';
import { LocaleFixture } from '@/components/dev/LocaleFixture';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { NewTableScreen } from '@/components/lobby/NewTableScreen';
import { BOT_CREW } from '@/features/lobby/fixtures';
import { InviteLinkModal } from '@/components/invites/InviteLinkModal';
import { TableInvitation } from '@/components/invites/TableInvitation';
import { DevOverlays, handHistory } from '@/game/canvas/DevOverlays';
import { loadGameCanvasDev } from '@/game/canvas/loadGameCanvasDev';
import type { GameCanvasDevProps } from '@/game/canvas/GameCanvasDev';
import type { Position, Room } from '@/types/lobby';
import type {
  Card,
  Invite,
  RuleSet,
  SeatInvitation,
  SeatStatus,
  ServerBid,
  ServerGameState,
} from '@pidro/shared';
import { TableFeedback, TableSeatDecision, useTableNotices } from '@/components/game/TableFeedback';
import type { TableNotice } from '@/game/tableNotices';
import { loadGameCanvasTable } from '@/game/canvas/loadGameCanvasTable';
import { useGameStore } from '@/stores/game';
import { useLocale } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';
import {
  HandResultTuner,
  SecondDealTuner,
  applyTimingParams,
} from '@/components/dev/SecondDealTuner';
import { handResultTiming } from '@/features/game/handResult';
import { secondDealDurationMs } from '@/game/canvas/animationTiming';
import type { HeldStyle } from '@/game/canvas/layout';

// `bids=`: a hand's bids landing one by one against three bots.
const BID_ROUNDS: Record<string, { dealer: Position; bids: ServerBid[] }> = {
  // South deals: West passes, North bids 7, East goes to 9, then it is you.
  round: {
    dealer: 'south',
    bids: [
      { position: 'west', amount: 'pass' },
      { position: 'north', amount: 7 },
      { position: 'east', amount: 9 },
    ],
  },
  // West deals: North bids 7, East passes, you go to 9, and West is still to bid.
  high: {
    dealer: 'west',
    bids: [
      { position: 'north', amount: 7 },
      { position: 'east', amount: 'pass' },
      { position: 'south', amount: 9 },
    ],
  },
};
const BID_STEP_MS = 450;

const DETAILS_HAND: Card[] = [
  { rank: 13, suit: 'diamonds' },
  { rank: 5, suit: 'clubs' },
  { rank: 13, suit: 'hearts' },
  { rank: 5, suit: 'spades' },
  { rank: 13, suit: 'clubs' },
  { rank: 14, suit: 'spades' },
];

// `out=`: hand 4 against the bot crew, two tricks in. Jocke (East) bid 6 and
// took the first trick for 2; you took the second, where Antti's 2 of trump
// fell. Marcel (West) is out of trumps and folds two cards face down. `lone`:
// everyone else has gone cold and the rest is yours.
const spade = (rank: number): Card => ({ rank, suit: 'spades' });
const OUT_TRICKS = [
  {
    cards: [
      { player: 'east', card: spade(14) },
      { player: 'south', card: spade(3) },
      { player: 'west', card: spade(11) },
      { player: 'north', card: spade(4) },
    ],
    winner: 'east',
    points: 2,
    two_of_trump: null,
  },
  {
    cards: [
      { player: 'east', card: spade(7) },
      { player: 'south', card: spade(13) },
      { player: 'west', card: spade(9) },
      { player: 'north', card: spade(2) },
    ],
    winner: 'south',
    points: 0,
    two_of_trump: { position: 'north', points: 1 },
  },
];
const OUT_HAND: Card[] = [spade(12), spade(10), spade(8), spade(5)];
const cold = (revealed: Card[]) => ({ hand: 0, eliminated: true, revealed_cards: revealed });
const OUT_PLAYERS = {
  one: {
    north: { hand: 4 },
    east: { hand: 4 },
    west: cold([
      { rank: 12, suit: 'hearts' },
      { rank: 9, suit: 'clubs' },
    ]),
    south: { hand: OUT_HAND },
  },
  lone: {
    north: cold([]),
    east: cold([{ rank: 6, suit: 'diamonds' }]),
    west: cold([
      { rank: 12, suit: 'hearts' },
      { rank: 9, suit: 'clubs' },
    ]),
    south: { hand: OUT_HAND },
  },
} as const;
// `trick=bots`: hand 4 against bots, hearts trump. Marcel, Antti and Jocke have
// played to the first trick and it is your turn.
const heart = (rank: number): Card => ({ rank, suit: 'hearts' });
const BOT_TRICK = [
  { player: 'west', card: heart(9) },
  { player: 'north', card: heart(13) },
  { player: 'east', card: heart(4) },
];
const BOT_TRICK_HAND: Card[] = [heart(14), heart(10), heart(5), heart(2)];
// `invitation=partner|opponent|rules`: in a game with bots, Bertil holds a seat
// for you (PID-258); `rules` is an older server that does not say as what.
const BERTIL: SeatInvitation = {
  code: 'BRTL',
  position: 'north',
  host_id: 'p-bertil',
  host: { user_id: 'p-bertil', display_name: 'Bertil', avatar_url: null },
  rule_set: 'finnish',
  held_since: '2026-10-19T12:00:00Z',
};
const INVITATIONS: Record<string, SeatInvitation> = {
  partner: { ...BERTIL, join_as: 'partner' },
  opponent: { ...BERTIL, position: 'east', join_as: 'opponent' },
  rules: BERTIL,
};
const TRUMP_HAND: Card[] = [
  heart(14),
  heart(11),
  heart(9),
  { rank: 5, suit: 'diamonds' },
  { rank: 10, suit: 'diamonds' },
  spade(13),
  spade(7),
  { rank: 12, suit: 'clubs' },
  { rank: 2, suit: 'clubs' },
];
const CLOCKWISE: Position[] = ['north', 'east', 'south', 'west'];
const nextSeat = (position: Position) => CLOCKWISE[(CLOCKWISE.indexOf(position) + 1) % 4];
const highBid = (bids: ServerBid[]) => bids.filter((bid) => bid.amount !== 'pass').at(-1) ?? null;

const DEALER_SELECTION_MS = 3_000;
// East cuts the ace and deals.
const DEALER_CUTS: Partial<Record<Position, Card>> = {
  north: { rank: 9, suit: 'clubs' },
  east: { rank: 14, suit: 'spades' },
  south: { rank: 5, suit: 'hearts' },
  west: { rank: 7, suit: 'diamonds' },
};

const DEAL_HAND: Card[] = [
  { rank: 8, suit: 'clubs' },
  { rank: 14, suit: 'spades' },
  { rank: 3, suit: 'hearts' },
  { rank: 11, suit: 'diamonds' },
  { rank: 13, suit: 'clubs' },
  { rank: 10, suit: 'hearts' },
  { rank: 2, suit: 'spades' },
  { rank: 6, suit: 'diamonds' },
  { rank: 12, suit: 'hearts' },
];

const DEALER_POOL: Card[] = [
  ...DEAL_HAND,
  { rank: 5, suit: 'spades' },
  { rank: 11, suit: 'spades' },
  { rank: 4, suit: 'clubs' },
];

const WAITING_ROOM: Room = {
  code: 'DEV01',
  name: 'Friday friends',
  status: 'waiting',
  host_id: 'p-south',
  player_count: 3,
  max_players: 4,
  positions: {
    north: 'p-north',
    east: null,
    south: 'p-south',
    west: 'p-west',
  },
  seats: [
    {
      seat_index: 1,
      status: 'occupied',
      player: {
        id: 'p-south',
        username: 'Alexandria the Long-Named Player',
        level: 44,
        pin: 'classic',
      },
      position: 'south',
    },
    {
      seat_index: 2,
      status: 'occupied',
      player: {
        id: 'p-west',
        username: 'mfios1',
        avatar_url: fixtureAvatar('i', '#437d9e'),
        level: 18,
      },
      position: 'west',
    },
    {
      seat_index: 3,
      status: 'occupied',
      player: { id: 'p-north', is_bot: true, ...BOT_CREW[0] },
      position: 'north',
    },
    { seat_index: 4, status: 'free', player: null, position: 'east' },
  ],
};

/** `bids=`: a solo table, you and the bot crew, as a quick game seats it. */
const BOT_ROOM: Room = {
  ...WAITING_ROOM,
  status: 'playing',
  player_count: 4,
  positions: { north: 'b-north', east: 'b-east', south: 'p-south', west: 'b-west' },
  seats: [
    { ...WAITING_ROOM.seats![0], player: { id: 'p-south', username: 'Mia', level: 44 } },
    ...(['west', 'north', 'east'] as const).map((position, index) => ({
      seat_index: index + 2,
      status: 'occupied' as const,
      player: { id: `b-${position}`, is_bot: true, ...BOT_CREW[index] },
      position,
    })),
  ],
};

// `names=long` (PID-304): Marcel's TCL table. West is ironman3001, North a
// long name, East a bot, so every corner of every seat can be checked.
const LONG_NAMES_ROOM: Room = {
  ...BOT_ROOM,
  positions: { north: 'p-north', east: 'b-east', south: 'p-south', west: 'p-west' },
  seats: BOT_ROOM.seats!.map((seat) =>
    seat.position === 'west'
      ? {
          ...seat,
          player: {
            id: 'p-west',
            username: 'ironman3001',
            avatar_url: fixtureAvatar('i', '#437d9e'),
            level: 18,
          },
        }
      : seat.position === 'north'
        ? { ...seat, player: { id: 'p-north', username: 'Margaretha Lindqvist', level: 31 } }
        : seat
  ),
};

// JA36's seating, unlike the usual quick-game bot order.
const FOLD_TRICK_ROOM: Room = {
  ...BOT_ROOM,
  code: 'JA36',
  seats: BOT_ROOM.seats!.map((seat) => ({
    ...seat,
    player: {
      ...seat.player!,
      ...(seat.position === 'south'
        ? { username: 'Marcel' }
        : BOT_CREW[seat.position === 'north' ? 2 : seat.position === 'west' ? 1 : 0]),
    },
  })),
};

/** `deal=draw`: four people at the table, North bid 9 and West deals. */
const DRAW_ROOM: Room = {
  ...BOT_ROOM,
  seats: (
    [
      ['south', 'Mia', 44],
      ['west', 'Wynn', 18],
      ['north', 'Nora', 31],
      ['east', 'Eli', 12],
    ] as const
  ).map(([position, username, level], index) => ({
    seat_index: index + 1,
    status: 'occupied' as const,
    player: { id: BOT_ROOM.positions![position]!, username, level },
    position,
  })),
};

const DRAW_TRUMP_HAND: Card[] = [spade(14), spade(11)];
const DRAW_DEALT: Card[] = [
  ...DRAW_TRUMP_HAND,
  { rank: 13, suit: 'hearts' },
  { rank: 8, suit: 'diamonds' },
  { rank: 4, suit: 'clubs' },
  { rank: 12, suit: 'hearts' },
  { rank: 7, suit: 'clubs' },
  { rank: 3, suit: 'diamonds' },
  { rank: 9, suit: 'hearts' },
];
const DRAW_REFILLED: Card[] = [
  ...DRAW_TRUMP_HAND,
  spade(10),
  { rank: 6, suit: 'hearts' },
  { rank: 12, suit: 'clubs' },
  { rank: 7, suit: 'diamonds' },
];
/** Kept after the discard, drawn to refill. West deals, so it robs the pack. */
const DRAW_COUNTS = {
  north: { kept: 1, drawn: 5 },
  east: { kept: 3, drawn: 3 },
  south: { kept: 2, drawn: 4 },
  west: { kept: 4, drawn: 2 },
} as const;
/** `you=deal`: you deal and keep two trumps; the others drew 10, so six are left for you. */
const DRAW_COUNTS_YOU_DEAL = {
  north: { kept: 1, drawn: 5 },
  east: { kept: 3, drawn: 3 },
  south: { kept: 2, drawn: 0 },
  west: { kept: 4, drawn: 2 },
} as const;
const DRAW_YOU_POOL: Card[] = [
  ...DRAW_TRUMP_HAND,
  spade(10),
  spade(5),
  spade(2),
  { rank: 6, suit: 'hearts' },
  { rank: 12, suit: 'clubs' },
  { rank: 7, suit: 'diamonds' },
];
const DRAW_YOU_KEEP: Card[] = DRAW_YOU_POOL.slice(0, 5).concat([{ rank: 12, suit: 'clubs' }]);
const DRAW_FIRST_TRICK = [
  { player: 'north', card: spade(13) },
  { player: 'east', card: spade(9) },
  { player: 'south', card: spade(10) },
  { player: 'west', card: spade(3) },
] as const;

function fixtureAvatar(initial: string, color: string) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${color}"/><text x="40" y="54" text-anchor="middle" font-size="48" fill="white">${initial}</text></svg>`)}`;
}

const INVITE_FIXTURE: Invite = {
  code: '7KQ4M2XB',
  state: 'open',
  url: 'https://www.pidro.online/j/7KQ4M2XB',
  share_text: 'Come play Pidro with me 🃏 https://www.pidro.online/j/7KQ4M2XB — code 7KQ4-M2XB',
  seat_hint: 'partner',
  label: 'Friday game',
  expires_at: '2099-09-03T15:30:00Z',
};

function Loading() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#081422',
      }}>
      <Text style={{ color: 'white' }}>Loading Skia…</Text>
    </View>
  );
}

const NORA_LOST: TableNotice = {
  key: 'game.notice_disconnected_seat',
  seat: { name: 'Nora', position: 'north' },
  variant: 'warning',
};

/** The real notice queue: `timed` replays a burst, otherwise one notice shows until tapped. */
function FixtureTableFeedback({ timed, notice }: { timed?: boolean; notice?: TableNotice | null }) {
  const { notice: shown, addNotice, dismissNotice } = useTableNotices(WAITING_ROOM.code);

  useEffect(() => {
    if (!timed) {
      if (notice) addNotice(notice);
      return;
    }
    const timers = [
      setTimeout(() => addNotice(NORA_LOST), 800),
      setTimeout(() => addNotice(NORA_LOST), 1_000),
      setTimeout(
        () => addNotice({ key: 'game.notice_back', params: { name: 'Nora' }, variant: 'success' }),
        1_200
      ),
    ];
    return () => timers.forEach(clearTimeout);
  }, [addNotice, notice, timed]);

  return <TableFeedback notice={shown} onDismiss={dismissNotice} />;
}

function SkiaDevTable({
  onHandPresentationReadyChange,
  autoPlay,
  phase,
  lifecycle,
}: GameCanvasDevProps) {
  const [Comp, setComp] = useState<ComponentType<GameCanvasDevProps> | null>(null);

  useEffect(() => {
    let active = true;
    loadGameCanvasDev()
      .then((Component) => {
        if (active) setComp(() => Component);
      })
      .catch((error) => console.error('[TableDev] failed to load Skia table', error));
    return () => {
      active = false;
    };
  }, []);

  return Comp ? (
    <Comp
      onHandPresentationReadyChange={onHandPresentationReadyChange}
      autoPlay={autoPlay}
      phase={phase}
      lifecycle={lifecycle}
    />
  ) : (
    <Loading />
  );
}

export default function TableDevRoute() {
  if (!__DEV__) return <Redirect href="/home" />;
  return (
    <LocaleFixture>
      <TableDevHarness />
    </LocaleFixture>
  );
}

function TableDevHarness() {
  const locale = useLocale();
  const params = useLocalSearchParams<{
    fixture?: string;
    loading?: string;
    late?: string;
    phase?: string;
    autoplay?: string;
    invite?: string;
    lifecycle?: SeatStatus;
    feedback?: string;
    role?: string;
    playerName?: string;
    notice?: string;
    names?: string;
    safeArea?: string;
    pass?: string;
    viewer?: string;
    rematch?: string;
    result?: string;
    xp?: string;
    readyResult?: string;
    deal?: string;
    dealer?: string;
    clear?: string;
    guest?: string;
    crew?: string;
    people?: string;
    connection?: string;
    bids?: string;
    out?: string;
    trick?: string;
    count?: string;
    bidder?: Position;
    hand?: string;
    you?: string;
    end?: string;
    invitation?: string;
    botTurn?: Position;
    botHand?: string;
  }>();
  const fixture = params.fixture;
  const ruleSet: RuleSet = fixture?.startsWith('louisiana') ? 'louisiana' : 'finnish';
  const rulesFixtureSeen = !fixture?.endsWith('explainer');
  const phase = fixture?.endsWith('game-over')
    ? 'game_over'
    : fixture?.endsWith('bidding')
      ? 'bidding'
      : fixture?.includes('waiting')
        ? 'waiting'
        : typeof params.phase === 'string'
          ? params.phase
          : 'playing';
  const autoPlay = params.autoplay === 'true';
  const [isHandReady, setIsHandReady] = useState(false);
  const [dismissed, setDismissed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const names = ['Nora', 'Eli', 'Wynn'];
  const positions = ['north', 'east', 'west'] as const;
  const viewerPosition = params.viewer === 'east' ? 'east' : 'south';
  const [readyPlayers, setReadyPlayers] = useState<Position[]>(
    phase === 'ready-solo'
      ? (['north', 'east', 'south', 'west'] as Position[]).filter(
          (position) => position !== viewerPosition
        )
      : ['north', 'west']
  );
  const [waitingPositions, setWaitingPositions] = useState<Room['positions']>();
  const [inviteOpen, setInviteOpen] = useState(params.invite === 'true');

  if (params.deal === 'hand') {
    applyTimingParams(params as Record<string, string | undefined>);
    return (
      <SafeAreaProvider>
        <FixtureInsets preset={params.safeArea}>
          <HandEndPreview
            result={
              params.end === 'we-made' ||
              params.end === 'we-missed' ||
              params.end === 'they-missed' ||
              params.end === 'game-over'
                ? params.end
                : 'they-made'
            }
          />
        </FixtureInsets>
      </SafeAreaProvider>
    );
  }

  if (params.deal === 'draw') {
    applyTimingParams(params as Record<string, string | undefined>);
    return (
      <SafeAreaProvider>
        <FixtureInsets preset={params.safeArea}>
          <DrawCountPreview
            held={params.hand === 'still' || params.hand === 'fan' ? params.hand : 'tilt'}
            youDeal={params.you === 'deal'}
          />
        </FixtureInsets>
      </SafeAreaProvider>
    );
  }

  if (
    !['play-motion', 'scores-game-over', 'all-14', 'all-14-theirs'].includes(fixture ?? '') &&
    (fixture || params.role || phase === 'second_deal' || phase === 'declaring') &&
    !phase.startsWith('waiting') &&
    !phase.startsWith('ready')
  ) {
    return (
      <SafeAreaProvider>
        <FixtureInsets preset={params.safeArea}>
          <RolePreview
            role={params.role === 'spectator' ? 'spectator' : 'player'}
            phase={phase}
            feedback={params.feedback}
            canPass={params.pass !== 'disabled'}
            deal={params.deal}
            dealer={params.dealer}
            autoClear={params.clear === 'true'}
            ruleSet={ruleSet}
            rulesFixtureSeen={rulesFixtureSeen}
            connected={params.connection !== 'lost'}
            bidRound={BID_ROUNDS[params.bids ?? ''] ?? null}
            outPlayers={OUT_PLAYERS[params.out as keyof typeof OUT_PLAYERS] ?? null}
            botTrick={params.trick === 'bots'}
            botCrew={fixture === 'bot-crew'}
            botTurn={params.botTurn}
            botHand={Number(params.botHand) || 4}
            fold={
              fixture === 'fold'
                ? 'count'
                : fixture === 'fold-legacy'
                  ? 'legacy'
                  : fixture === 'fold-trick'
                    ? 'trick'
                    : fixture === 'fold-trick-self'
                      ? 'trick-self'
                      : undefined
            }
            countHelp={params.count === 'on'}
            details={fixture === 'details'}
            bidder={params.bidder}
            longNames={params.names === 'long'}
            scoreHistory={fixture === 'scores'}
            invitation={INVITATIONS[params.invitation ?? ''] ?? null}
            loading={params.loading ? Number(params.loading) : undefined}
            dealerLate={fixture === 'dealer-late' ? Number(params.late) || 0 : undefined}
          />
        </FixtureInsets>
      </SafeAreaProvider>
    );
  }

  if (
    phase === 'waiting' ||
    phase === 'waiting-host' ||
    phase === 'ready' ||
    phase === 'ready-host' ||
    phase === 'ready-solo'
  ) {
    const hostControls = phase === 'waiting-host' || phase === 'ready-host';
    const full = phase.startsWith('ready');
    const waitingRoom: Room = full
      ? {
          ...WAITING_ROOM,
          positions: { ...WAITING_ROOM.positions!, east: 'p-east' },
          seats: WAITING_ROOM.seats!.map((seat) =>
            seat.position === 'east'
              ? {
                  ...seat,
                  status: 'occupied',
                  player: {
                    id: 'p-east',
                    username: 'mfand1',
                    avatar_url: fixtureAvatar('a', '#8e6851'),
                  },
                }
              : seat
          ),
        }
      : WAITING_ROOM;
    let bot = 0;
    const fixtureRoom = {
      ...waitingRoom,
      host_id: `p-${viewerPosition}`,
      positions: waitingPositions ?? waitingRoom.positions,
      seats: waitingRoom.seats?.map((seat) =>
        waitingPositions && seat.position && !waitingPositions[seat.position]
          ? { ...seat, status: 'free' as const, player: null }
          : phase === 'ready-solo' && seat.player
            ? {
                ...seat,
                player:
                  seat.position === viewerPosition
                    ? { id: seat.player.id, username: 'Alex' }
                    : { id: seat.player.id, is_bot: true, ...BOT_CREW[bot++ % 3] },
              }
            : params.names === 'long' && seat.player?.id === 'p-west'
              ? {
                  ...seat,
                  player: { ...seat.player, username: 'Alexandria the Long-Named Player' },
                }
              : params.fixture === 'held' && seat.position === 'east'
                ? { ...seat, held_for: { user_id: 'nora', display_name: 'Nora', avatar_url: null } }
                : seat
      ),
    };
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#081422' }}>
        <SafeAreaProvider>
          <FixtureInsets preset={params.safeArea}>
            <NewTableScreen
              room={
                fixture
                  ? {
                      ...fixtureRoom,
                      config: {
                        name: null,
                        bot_difficulty: 'basic',
                        solo: false,
                        ...fixtureRoom.config,
                        rule_set: ruleSet,
                      },
                    }
                  : fixtureRoom
              }
              rulesFixtureSeen={fixture ? rulesFixtureSeen : undefined}
              isSpectator={params.role === 'spectator'}
              readyPlayers={full ? readyPlayers : ['north']}
              readyDisabled={false}
              onReady={async () => {
                if (params.readyResult === 'error') throw new Error('Fixture readiness failure');
                await new Promise((resolve) => setTimeout(resolve, 500));
                setReadyPlayers((current) => [...current, viewerPosition]);
              }}
              youPlayerId={`p-${viewerPosition}`}
              onLeave={() => {}}
              canManage={hostControls}
              onOpenInvite={() => setInviteOpen(true)}
              onKickPlayer={(position) => {
                setWaitingPositions({ ...fixtureRoom.positions!, [position]: null });
                setReadyPlayers(['north']);
              }}
              notice={
                params.notice === 'true'
                  ? {
                      ...(locale === 'sv'
                        ? {
                            key: 'game.notice_joined_seat' as const,
                            seat: { name: 'Nora', position: 'north' as const },
                          }
                        : { message: 'Nora joined the table.' }),
                      variant: 'success',
                    }
                  : null
              }
            />
          </FixtureInsets>
          {hostControls && inviteOpen ? (
            <InviteLinkModal
              roomCode={WAITING_ROOM.code}
              onClose={() => setInviteOpen(false)}
              fixture={INVITE_FIXTURE}
            />
          ) : null}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#081422' }}>
      <SafeAreaProvider>
        <FixtureInsets preset={params.safeArea}>
          <SkiaDevTable
            onHandPresentationReadyChange={setIsHandReady}
            autoPlay={autoPlay}
            phase={phase === 'dealer_selection' || phase === 'game_over' ? phase : 'playing'}
            lifecycle={params.lifecycle}
          />
          <DevOverlays
            phase={phase}
            isHandReady={isHandReady}
            canPass={params.pass !== 'disabled'}
            rematch={params.rematch}
            result={params.result}
            xp={params.xp}
            playerName={params.playerName}
            guest={params.guest === 'true'}
            crew={params.crew === 'win' || params.crew === 'loss' ? params.crew : undefined}
            people={params.people === 'win' || params.people === 'loss' ? params.people : undefined}
          />
          {params.feedback === 'owner' && (
            <TableSeatDecision
              decisions={{
                decision:
                  params.feedback === 'owner' && dismissed < 3
                    ? {
                        key: String(dismissed),
                        id: String(dismissed),
                        position: positions[dismissed],
                        playerNameRaw:
                          (dismissed === 0 ? (params.playerName ?? names[0]) : names[dismissed]) ||
                          null,
                        playerName:
                          dismissed === 0 ? (params.playerName ?? names[0]) : names[dismissed],
                      }
                    : null,
                pendingCount: 3 - dismissed,
                busy,
                error,
                errorCause: error,
                keepBot: async () => {
                  setDismissed((count) => count + 1);
                  setError(null);
                },
                openSeat: async () => {
                  setBusy(true);
                  setError(null);
                  await new Promise((resolve) => setTimeout(resolve, 800));
                  setError('Could not confirm the seat update. Please try again.');
                  setBusy(false);
                },
              }}
            />
          )}
          <FixtureTableFeedback
            timed={params.feedback === 'timed'}
            notice={params.feedback === 'notice' || params.notice === 'true' ? NORA_LOST : null}
          />
        </FixtureInsets>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** `deal=true`: the server's dealt hand lands this long after the table opens. */
const DEAL_AT_MS = 900;
const dealtFrom = (initial: ServerGameState): ServerGameState => ({
  ...initial,
  phase: 'bidding',
  players: {
    north: { hand: 9 },
    east: { hand: 9 },
    west: { hand: 9 },
    south: { hand: DEAL_HAND },
  },
});

/** Exercise the production controller/store, not the animation-only mock model. */
function RolePreview({
  role,
  phase,
  feedback,
  canPass,
  deal,
  dealer,
  autoClear,
  ruleSet = 'finnish',
  rulesFixtureSeen,
  connected = true,
  bidRound = null,
  outPlayers = null,
  countHelp = false,
  details = false,
  bidder = 'east',
  longNames = false,
  botTrick = false,
  botCrew = false,
  botTurn = 'west',
  botHand = 4,
  invitation = null,
  fold,
  scoreHistory = false,
  loading,
  dealerLate,
}: {
  role: 'player' | 'spectator';
  phase: string;
  feedback?: string;
  canPass: boolean;
  deal?: string;
  dealer?: string;
  autoClear?: boolean;
  ruleSet?: RuleSet;
  rulesFixtureSeen?: boolean;
  connected?: boolean;
  bidRound?: (typeof BID_ROUNDS)[string] | null;
  outPlayers?: (typeof OUT_PLAYERS)[keyof typeof OUT_PLAYERS] | null;
  countHelp?: boolean;
  details?: boolean;
  bidder?: Position;
  /** `names=long`: ironman3001 at West and a long North name. */
  longNames?: boolean;
  botTrick?: boolean;
  botCrew?: boolean;
  botTurn?: Position;
  botHand?: number;
  invitation?: SeatInvitation | null;
  fold?: 'count' | 'legacy' | 'trick' | 'trick-self';
  scoreHistory?: boolean;
  /** `loading=0.4`: the cards are still decoding, 40% done. */
  loading?: number;
  /** `fixture=dealer-late&late=1500`: the dealer cut reaches a phone busy for 1.5 s. */
  dealerLate?: number;
}) {
  const [Table, setTable] = useState<Awaited<ReturnType<typeof loadGameCanvasTable>> | null>(null);
  const [invitationHeight, setInvitationHeight] = useState(0);
  const tableRoom = longNames
    ? LONG_NAMES_ROOM
    : fold === 'trick' || fold === 'trick-self'
      ? FOLD_TRICK_ROOM
      : bidRound || botTrick || botCrew || outPlayers || invitation || fold
        ? BOT_ROOM
        : WAITING_ROOM;
  useEffect(() => {
    let active = true;
    const store = useGameStore.getState();
    const previewPhase =
      phase === 'game_over'
        ? 'game_over'
        : phase === 'bidding'
          ? 'bidding'
          : phase === 'declaring'
            ? 'declaring'
            : phase === 'second_deal'
              ? 'second_deal'
              : 'playing';
    const dealerPosition = ['north', 'east', 'south', 'west'].includes(dealer ?? '')
      ? (dealer as Position)
      : bidRound
        ? bidRound.dealer
        : previewPhase === 'second_deal'
          ? 'south'
          : 'north';
    const automaticExisting: Card[] = [
      { rank: 14, suit: 'spades' },
      { rank: 13, suit: 'spades' },
    ];
    const automaticRobbed: Card[] = [
      { rank: 11, suit: 'spades' },
      { rank: 10, suit: 'spades' },
      { rank: 5, suit: 'spades' },
      { rank: 5, suit: 'clubs' },
      { rank: 2, suit: 'spades' },
      { rank: 6, suit: 'diamonds' },
    ];
    const automaticPool = [...automaticExisting, ...automaticRobbed];
    const automaticKept = [
      automaticExisting[0],
      automaticRobbed[0],
      automaticRobbed[1],
      automaticRobbed[2],
      automaticRobbed[3],
      automaticRobbed[4],
    ];
    useSettingsStore.setState({ countHelp, showBid: true });
    store.reset();
    store.initFromRoom({ room: tableRoom, youPlayerId: 'p-south' });
    store.setRole(role);
    store.setYouPosition('south');
    store.setChannelStatus(connected);
    if (botCrew) {
      store.applySeatLifecycle({
        room_id: 'bot-crew',
        room_code: tableRoom.code,
        revision: 1,
        owner_id: 'p-south',
        room_status: previewPhase === 'game_over' ? 'finished' : 'playing',
        seats: {
          south: { status: 'normal', player_id: 'p-south', username: 'Mia', decision: null },
          west: {
            status: 'permanent_bot',
            player_id: null,
            ...BOT_CREW[0],
            decision: null,
          },
          north: {
            status: 'permanent_bot',
            player_id: null,
            ...BOT_CREW[1],
            decision: null,
          },
          east: {
            status: 'permanent_bot',
            player_id: null,
            ...BOT_CREW[2],
            decision: null,
          },
        },
      });
    }
    store.setServerState({
      variant: ruleSet,
      config: { min_bid: ruleSet === 'louisiana' ? 7 : 6 },
      phase: deal === 'true' ? 'dealing' : previewPhase,
      current_player:
        previewPhase === 'second_deal'
          ? dealerPosition
          : bidRound
            ? bidRound.bids[0].position
            : botCrew
              ? botTurn
              : 'south',
      trump: previewPhase === 'playing' || previewPhase === 'second_deal' ? 'spades' : null,
      dealer: dealerPosition,
      scores: {
        north_south: scoreHistory ? 48 : previewPhase === 'game_over' ? 62 : 36,
        east_west: 29,
      },
      hand_history: scoreHistory ? handHistory('north_south').slice(0, 9) : undefined,
      hand_number: scoreHistory ? 10 : botCrew ? botHand : 4,
      players: {
        north: {
          hand:
            previewPhase === 'second_deal' && dealerPosition === 'north'
              ? 17
              : deal === 'true'
                ? 0
                : deal === 'cold'
                  ? 9
                  : 6,
        },
        east: { hand: deal === 'true' ? 0 : deal === 'cold' ? 9 : 6 },
        west: { hand: deal === 'true' ? 0 : deal === 'cold' ? 9 : 6 },
        south: {
          hand:
            previewPhase === 'second_deal' && dealerPosition === 'south'
              ? DEALER_POOL
              : phase === 'auto_rob'
                ? automaticKept
                : deal === 'true'
                  ? []
                  : deal === 'cold'
                    ? DEAL_HAND
                    : [
                        { rank: 14, suit: 'spades' },
                        { rank: 13, suit: 'hearts' },
                        ...(ruleSet === 'louisiana' ? [{ rank: 5, suit: 'clubs' as const }] : []),
                      ],
        },
      },
      current_trick:
        previewPhase === 'playing' && !botCrew
          ? [{ player: 'west', card: { rank: 5, suit: 'diamonds' } }]
          : [],
      ...(outPlayers && {
        dealer: 'north',
        players: outPlayers,
        bid_order: [
          { position: 'east', amount: 6 },
          { position: 'south', amount: 'pass' },
          { position: 'west', amount: 'pass' },
          { position: 'north', amount: 'pass' },
        ],
        highest_bid: { position: 'east', amount: 6 },
        tricks: OUT_TRICKS,
        current_trick: [],
      }),
      ...(botTrick && {
        dealer: 'north',
        trump: 'hearts',
        players: {
          north: { hand: 5 },
          east: { hand: 5 },
          west: { hand: 5 },
          south: { hand: BOT_TRICK_HAND },
        },
        highest_bid: { position: 'east', amount: 6 },
        current_trick: BOT_TRICK,
      }),
      ...(details && {
        highest_bid: { position: bidder, amount: 7 },
        players: {
          north: { hand: 6 },
          east: { hand: 6 },
          west: { hand: 6 },
          south: { hand: DETAILS_HAND },
        },
        current_trick: [],
      }),
      // PID-209: you dealt and won the bid; hearts, with the 5♦, is your best suit.
      ...(previewPhase === 'declaring' && {
        dealer: 'south',
        highest_bid: { position: 'south', amount: 8 },
        players: {
          north: { hand: 9 },
          east: { hand: 9 },
          west: { hand: 9 },
          south: { hand: TRUMP_HAND },
        },
      }),
    } as unknown as ServerGameState);
    if (phase === 'auto_rob') {
      store.setPresentation({
        dealer_rob: {
          dealer: dealerPosition,
          automatic: true,
          started_at_ms: Date.now(),
          ends_at_ms: Date.now() + 60_000,
          ...(role === 'player' && dealerPosition === 'south'
            ? {
                pool: automaticPool,
                kept: automaticKept,
                discarded: [automaticExisting[1], automaticRobbed[5]],
              }
            : {}),
        },
      });
    }
    const presentationTimer =
      phase === 'auto_rob' && autoClear
        ? setTimeout(() => store.setPresentation(null), 1_800)
        : null;
    store.setLegalActions(
      previewPhase === 'bidding'
        ? [
            ...([6, 7, 8, 9, 10, 11, 12, 13, 14] as const)
              .filter(
                (amount) =>
                  amount >= (ruleSet === 'louisiana' ? 7 : 6) &&
                  amount > Number(highBid(bidRound?.bids ?? [])?.amount ?? 0)
              )
              .map((amount) => ({ type: 'bid', amount }) as const),
            ...(canPass ? ([{ type: 'pass' }] as const) : []),
          ]
        : previewPhase === 'declaring'
          ? (['clubs', 'diamonds', 'hearts', 'spades'] as const).map(
              (suit) => ({ type: 'declare_trump', suit }) as const
            )
          : previewPhase === 'second_deal'
            ? dealerPosition === 'south' && role === 'player'
              ? [{ type: 'select_hand' as const, cards: [] }]
              : []
            : ruleSet === 'louisiana'
              ? [
                  { type: 'play_card', card: { rank: 13, suit: 'hearts' } },
                  { type: 'play_card', card: { rank: 5, suit: 'clubs' } },
                ]
              : outPlayers || botTrick || details
                ? (details ? DETAILS_HAND : botTrick ? BOT_TRICK_HAND : OUT_HAND).map((card) => ({
                    type: 'play_card' as const,
                    card,
                  }))
                : [{ type: 'play_card', card: { rank: 14, suit: 'spades' } }]
    );
    if (previewPhase === 'playing') {
      store.setTurnTimer({
        timerId: 1,
        scope: 'seat',
        position: 'south',
        phase: 'playing',
        durationMs: 30_000,
        transitionDelayMs: 0,
        serverTime: new Date().toISOString(),
        remainingMs: 30_000,
        receivedAtMs: Date.now(),
        eventSeq: 1,
      });
    }
    loadGameCanvasTable().then((component) => {
      if (active) setTable(() => component);
    });
    return () => {
      active = false;
      if (presentationTimer) clearTimeout(presentationTimer);
      store.reset();
    };
  }, [
    role,
    phase,
    canPass,
    deal,
    dealer,
    autoClear,
    ruleSet,
    connected,
    bidRound,
    outPlayers,
    countHelp,
    details,
    bidder,
    botTrick,
    botCrew,
    botTurn,
    botHand,
    tableRoom,
    scoreHistory,
  ]);

  // The dealer cut as the server times it: the cut, then the deal 3 s later.
  // The phone is busy for `dealerLate` ms when the cut arrives, as an old
  // phone is; it must catch up, not replay.
  useEffect(() => {
    if (!Table || dealerLate == null) return;
    const store = useGameStore.getState();
    const base = store.serverState!;
    const cutAt = Date.now();
    const clock = { cutAt, dealtAt: 0 };
    (globalThis as { __pidroDealerClock?: typeof clock }).__pidroDealerClock = clock;
    store.setLegalActions([]);
    store.setPresentation({
      dealer_selection: { started_at_ms: cutAt, ends_at_ms: cutAt + DEALER_SELECTION_MS },
    });
    store.setServerState({
      ...base,
      phase: 'dealer_selection',
      dealer: 'east',
      current_player: null,
      bid_order: [],
      highest_bid: null,
      current_trick: [],
      players: { north: { hand: 0 }, east: { hand: 0 }, south: { hand: [] }, west: { hand: 0 } },
      dealer_selection_cuts: DEALER_CUTS,
    } as unknown as ServerGameState);
    // Busy, as an old phone is: the cut is in, but nothing draws yet.
    while (Date.now() < cutAt + dealerLate);
    const dealt = {
      ...base,
      phase: 'bidding',
      dealer: 'east',
      current_player: 'south',
      bid_order: [],
      highest_bid: null,
      current_trick: [],
      dealer_selection_cuts: null,
      transition_delay_ms: 5_000,
      players: {
        north: { hand: 9 },
        east: { hand: 9 },
        south: { hand: DEAL_HAND },
        west: { hand: 9 },
      },
    } as unknown as ServerGameState;
    const timer = setTimeout(
      () => {
        clock.dealtAt = Date.now();
        store.setPresentation(null);
        store.setServerState(dealt);
      },
      cutAt + DEALER_SELECTION_MS - Date.now()
    );
    return () => clearTimeout(timer);
  }, [Table, dealerLate]);

  useEffect(() => {
    if (!Table || !fold) return;
    const store = useGameStore.getState();
    const initial = store.serverState;
    if (!initial) return;
    const midTrick = fold === 'trick' || fold === 'trick-self';
    const foldingSeat = fold === 'trick-self' ? 'south' : 'west';
    const leftovers: Record<Position, Card[]> = {
      north: [
        { rank: 8, suit: 'clubs' },
        { rank: 7, suit: 'diamonds' },
        { rank: 6, suit: 'hearts' },
      ],
      east: [],
      south: [
        { rank: 14, suit: 'hearts' },
        { rank: 10, suit: 'diamonds' },
        { rank: 9, suit: 'clubs' },
        { rank: 6, suit: 'clubs' },
      ],
      west: [
        { rank: 12, suit: 'hearts' },
        { rank: 9, suit: 'diamonds' },
      ],
    };
    if (midTrick) {
      leftovers[foldingSeat] = [
        { rank: 8, suit: 'diamonds' },
        { rank: 2, suit: 'spades' },
      ];
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    let hand = 4;
    const cycle = () => {
      timers.length = 0;
      let state = {
        ...initial,
        phase: 'playing',
        hand_number: midTrick ? 5 : hand++,
        trump: midTrick ? 'hearts' : initial.trump,
        current_player: midTrick ? foldingSeat : 'east',
        current_trick: midTrick
          ? [
              { player: 'north', card: heart(6) },
              ...(fold === 'trick-self' ? [{ player: 'east', card: heart(8) }] : []),
            ]
          : [],
        // Hold the reported trick on the table; earlier cards were not supplied.
        tricks: [],
        current_trick_details: midTrick
          ? {
              number: fold === 'trick' ? 4 : 1,
              leader: 'north',
              winning:
                fold === 'trick-self'
                  ? { position: 'east', card: heart(8) }
                  : { position: 'north', card: heart(6) },
            }
          : undefined,
        players: {
          north: { hand: 3 },
          east: { hand: 4 },
          south: { hand: fold === 'trick-self' ? [heart(9), ...leftovers.south] : leftovers.south },
          west: { hand: midTrick ? 3 : 2 },
        },
      } as ServerGameState;
      store.setLegalActions([]);
      store.setTurnTimer(null);
      store.setServerState(state);
      if (midTrick) {
        timers.push(
          setTimeout(() => {
            state = {
              ...state,
              current_player: fold === 'trick-self' ? 'west' : null,
              current_trick: [...state.current_trick!, { player: foldingSeat, card: heart(9) }],
              current_trick_details: {
                number: fold === 'trick' ? 4 : 1,
                leader: 'north',
                winning: { position: foldingSeat, card: heart(9) },
              },
              players: {
                ...state.players,
                [foldingSeat]: { hand: foldingSeat === 'south' ? leftovers.south : 2 },
              },
            };
            store.setServerState(state);
          }, 700)
        );
        // A separate, synthetic completed trick keeps the winner visible after completion.
        if (fold === 'trick-self') {
          timers.push(
            setTimeout(() => {
              state = {
                ...state,
                current_player: 'south',
                current_trick: [],
                current_trick_details: undefined,
                tricks: [
                  {
                    cards: [...state.current_trick!, { player: 'west', card: heart(7) }],
                    winner: 'south',
                    points: 0,
                  },
                ],
                players: { ...state.players, west: { hand: 2 } },
              };
              store.setServerState(state);
            }, 1000)
          );
        }
      }
      const foldOrder: readonly Position[] = midTrick ? [foldingSeat] : ['west', 'north', 'south'];
      for (const [i, position] of foldOrder.entries()) {
        timers.push(
          setTimeout(
            () => {
              state = {
                ...state,
                current_player: fold === 'trick-self' ? 'north' : state.current_player,
                players: {
                  ...state.players,
                  [position]: {
                    hand: 0,
                    eliminated: true,
                    ...(fold !== 'legacy'
                      ? { folded_count: leftovers[position].length }
                      : { revealed_cards: leftovers[position] }),
                  },
                },
              };
              store.setServerState(state);
            },
            1200 + i * 900
          )
        );
      }
      timers.push(
        setTimeout(() => {
          store.setServerState({ ...state, phase: 'bidding', current_trick: [], tricks: [] });
        }, 16000)
      );
    };
    cycle();
    const loop = setInterval(cycle, 18000);
    return () => {
      clearInterval(loop);
      timers.forEach(clearTimeout);
    };
  }, [Table, fold]);

  useEffect(() => {
    if (!Table || deal !== 'true') return;
    const store = useGameStore.getState();
    const initial = store.serverState;
    if (!initial) return;
    const timer = setTimeout(() => store.setServerState(dealtFrom(initial)), DEAL_AT_MS);
    return () => clearTimeout(timer);
    // Re-arm whenever the initialization effect above resets the fixture.
  }, [Table, deal, dealer, role, phase, canPass]);

  // `bids=`: the seats bid in turn, as the server tells it.
  useEffect(() => {
    if (!Table || !bidRound) return;
    const store = useGameStore.getState();
    const served = store.serverState;
    if (!served) return;
    // With `deal=true` the bots bid while the cards are still being dealt (PID-267).
    const initial = deal === 'true' ? dealtFrom(served) : served;
    const start = deal === 'true' ? DEAL_AT_MS : 0;
    const timers = bidRound.bids.map((bid, index) =>
      setTimeout(
        () => {
          const bids = bidRound.bids.slice(0, index + 1);
          const high = highBid(bids);
          store.setServerState({
            ...initial,
            current_player: nextSeat(bid.position),
            bids,
            ...(high ? { highest_bid: high } : {}),
          } as unknown as ServerGameState);
        },
        start + BID_STEP_MS * (index + 1)
      )
    );
    return () => timers.forEach(clearTimeout);
  }, [Table, bidRound, role, phase, canPass, dealer, deal]);
  return (
    <View className="flex-1">
      {Table ? (
        <Table
          room={tableRoom}
          rulesFixtureSeen={rulesFixtureSeen}
          onLeave={() => {}}
          rematch={
            botCrew && phase === 'game_over' ? { needed: 1, agreed: 0, youAgreed: false } : null
          }
          topDock={invitation ? invitationHeight : 0}
          loading={loading}
        />
      ) : (
        <Loading />
      )}
      <FixtureTableFeedback
        timed={feedback === 'timed'}
        notice={feedback === 'notice' ? NORA_LOST : null}
      />
      {Table && invitation ? (
        <TableInvitation
          invitation={invitation}
          roomCode={tableRoom.code}
          onHeight={setInvitationHeight}
          fixture
        />
      ) : null}
    </View>
  );
}

/**
 * `deal=draw`: the second deal on a loop, as the server sends it. Trump is
 * named with everyone holding nine; the next snapshot is the hand ready to
 * play (the second deal and the dealer's pick done), and play waits for the
 * table to play the second deal out. Then it deals again. `you=deal` has you
 * deal. Tune opens the second deal's timings; the link takes them too
 * (`holdMs=3000&cardMs=230`…).
 */
function DrawCountPreview({ held, youDeal }: { held: HeldStyle; youDeal: boolean }) {
  const [Table, setTable] = useState<Awaited<ReturnType<typeof loadGameCanvasTable>> | null>(null);
  const [run, setRun] = useState(0);
  const counts = youDeal ? DRAW_COUNTS_YOU_DEAL : DRAW_COUNTS;
  const dealer: Position = youDeal ? 'south' : 'west';
  const dealt = (['north', 'east', 'south', 'west'] as const)
    .filter((position) => position !== dealer)
    .reduce((sum, position) => sum + counts[position].drawn, 0);
  useEffect(() => {
    let active = true;
    loadGameCanvasTable().then((component) => {
      if (active) setTable(() => component);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!Table) return;
    const store = useGameStore.getState();
    // The server counts only the players dealt to: the dealer's stay theirs.
    const dealtTo: Position[] = (['north', 'east', 'south', 'west'] as const).filter(
      (position) => position !== dealer
    );
    const seats = (hands: Record<Position, Card[] | number>, counted: boolean) =>
      Object.fromEntries(
        (['north', 'east', 'south', 'west'] as const).map((position) => [
          position,
          {
            hand: hands[position],
            ...(counted &&
              dealtTo.includes(position) && {
                kept_count: counts[position].kept,
                drawn_count: counts[position].drawn,
              }),
          },
        ])
      );
    const base = {
      variant: 'finnish',
      config: { min_bid: 6 },
      dealer,
      hand_number: 3,
      scores: { north_south: 34, east_west: 21 },
      highest_bid: { position: 'north', amount: 9 },
      bid_order: [
        { position: 'north', amount: 9 },
        { position: 'east', amount: 'pass' },
        { position: 'south', amount: 'pass' },
        { position: 'west', amount: 'pass' },
      ],
      tricks: [],
      current_trick: [],
      trump: 'spades',
    };
    const yours = youDeal ? DRAW_YOU_KEEP : DRAW_REFILLED;
    const ready = { north: 6, east: 6, south: yours, west: 6 };
    const trick = (plays: number) => DRAW_FIRST_TRICK.slice(0, plays);
    const after = (plays: number) => ({
      north: 6 - (plays > 0 ? 1 : 0),
      east: 6 - (plays > 1 ? 1 : 0),
      south: plays > 2 ? yours.filter((card) => card.rank !== 10) : yours,
      west: 6 - (plays > 3 ? 1 : 0),
    });
    const playing = (current: Position, plays: number) => ({
      ...base,
      phase: 'playing',
      current_player: current,
      current_trick: trick(plays),
      players: seats(after(plays), true),
    });
    // Play waits for the second deal to play out, as the server holds it.
    const play = 1500 + secondDealDurationMs(dealt) + 800;
    const frames: [number, Record<string, unknown>][] = [
      [
        0,
        {
          ...base,
          phase: 'declaring',
          trump: null,
          current_player: 'north',
          players: seats({ north: 9, east: 9, south: DRAW_DEALT, west: 9 }, false),
        },
      ],
      [1500, { ...base, phase: 'playing', current_player: 'north', players: seats(ready, true) }],
      [play, playing('east', 1)],
      [play + 1500, playing('south', 2)],
      [play + 3000, playing('west', 3)],
      [play + 4500, playing('north', 4)],
    ];
    store.reset();
    store.initFromRoom({ room: DRAW_ROOM, youPlayerId: 'p-south' });
    store.setRole('player');
    store.setYouPosition('south');
    store.setChannelStatus(true);
    store.setLegalActions([]);
    // Dealing yourself, the server sends your pool with the snapshot that
    // ends the deal: both land in the same tick here.
    const yourPool = () =>
      store.setPresentation({
        dealer_rob: {
          dealer: 'south',
          automatic: true,
          started_at_ms: Date.now(),
          ends_at_ms: Date.now() + 5_000,
          pool: DRAW_YOU_POOL,
          kept: DRAW_YOU_KEEP,
          discarded: DRAW_YOU_POOL.filter((card) => !DRAW_YOU_KEEP.includes(card)),
        },
      });
    const timers = frames.map(([at, state]) =>
      setTimeout(() => {
        if (youDeal && at === 1500) yourPool();
        store.setServerState(state as unknown as ServerGameState);
      }, at)
    );
    if (youDeal) timers.push(setTimeout(() => store.setPresentation(null), 6_500));
    // Hold on the finished trick, then deal again.
    timers.push(setTimeout(() => setRun((n) => n + 1), play + 7_000));
    return () => timers.forEach(clearTimeout);
  }, [Table, run, youDeal, counts, dealer, dealt]);

  return (
    <View style={{ flex: 1 }}>
      {Table ? (
        <Table key={run} room={DRAW_ROOM} rulesFixtureSeen onLeave={() => {}} held={held} />
      ) : (
        <Loading />
      )}
      <SecondDealTuner dealt={dealt} onReplay={() => setRun((n) => n + 1)} />
    </View>
  );
}

type HandEnd = 'they-made' | 'we-made' | 'we-missed' | 'they-missed' | 'game-over';
/** `deal=hand`: who bid what, and what each side took, 14 points in all. */
const HAND_ENDS: Record<HandEnd, { bidder: Position; bid: number; ns: number }> = {
  'they-made': { bidder: 'east', bid: 6, ns: 8 },
  'we-made': { bidder: 'north', bid: 8, ns: 8 },
  'we-missed': { bidder: 'south', bid: 10, ns: 8 },
  'they-missed': { bidder: 'west', bid: 9, ns: 8 },
  'game-over': { bidder: 'north', bid: 10, ns: 14 },
};

/**
 * `deal=hand`: the last trick of a hand, the result, and the next hand dealt
 * once the result closes, on a loop. The server sends the next hand with the
 * one that ended; the table holds the ended hand while its result shows.
 * `end=they-made|we-made|we-missed|they-missed`; Tune changes how long
 * the result stays (`showMs=` in the link).
 */
function HandEndPreview({ result }: { result: HandEnd }) {
  const [Table, setTable] = useState<Awaited<ReturnType<typeof loadGameCanvasTable>> | null>(null);
  const [run, setRun] = useState(0);
  useEffect(() => {
    let active = true;
    loadGameCanvasTable().then((component) => {
      if (active) setTable(() => component);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!Table) return;
    const store = useGameStore.getState();
    const end = HAND_ENDS[result];
    const team = (position: Position) =>
      position === 'north' || position === 'south' ? 'north_south' : 'east_west';
    const biddingTeam = team(end.bidder);
    const captured = { north_south: end.ns, east_west: 14 - end.ns };
    const made = captured[biddingTeam] >= end.bid;
    const delta = {
      north_south: biddingTeam === 'north_south' && !made ? -end.bid : captured.north_south,
      east_west: biddingTeam === 'east_west' && !made ? -end.bid : captured.east_west,
    };
    const before = { north_south: result === 'game-over' ? 48 : 30, east_west: 21 };
    const heart = (rank: number): Card => ({ rank, suit: 'hearts' });
    const scored = (card: Card, points: number, position: Position) => ({
      card,
      points,
      position: result === 'game-over' ? 'north' : position,
      team: result === 'game-over' ? 'north_south' : team(position),
    });
    const lastHand = {
      hand_number: 5,
      bidding_team: biddingTeam,
      bidder: end.bidder,
      bid: end.bid,
      trump: 'hearts',
      captured,
      made,
      delta,
      scores: {
        north_south: before.north_south + delta.north_south,
        east_west: before.east_west + delta.east_west,
      },
      point_cards: [
        scored(heart(2), 1, 'south'),
        scored(heart(14), 1, 'east'),
        scored(heart(10), 1, 'north'),
        scored(heart(11), 1, 'south'),
        scored(heart(5), 5, 'west'),
        scored({ rank: 5, suit: 'diamonds' }, 5, 'north'),
      ],
    };
    const base = {
      variant: 'finnish',
      config: { min_bid: 6 },
      trump: 'hearts',
      highest_bid: { position: end.bidder, amount: end.bid },
    };
    const frames: [number, Record<string, unknown>][] = [
      [
        0,
        {
          ...base,
          phase: 'playing',
          dealer: 'west',
          hand_number: 5,
          current_player: 'south',
          scores: before,
          tricks: [],
          current_trick: [
            { player: 'west', card: heart(5) },
            { player: 'north', card: { rank: 5, suit: 'diamonds' } },
            { player: 'east', card: heart(7) },
          ],
          players: {
            north: { hand: 0 },
            east: { hand: 0 },
            west: { hand: 0 },
            south: { hand: [heart(11)] },
          },
        },
      ],
      [
        1500,
        {
          ...base,
          phase: 'bidding',
          trump: null,
          dealer: 'north',
          hand_number: 6,
          current_player: 'east',
          scores: lastHand.scores,
          last_hand: lastHand,
          tricks: [],
          current_trick: [],
          bid_order: [],
          players: {
            north: { hand: 9 },
            east: { hand: 9 },
            west: { hand: 9 },
            south: { hand: DRAW_DEALT },
          },
          ...(result === 'game-over'
            ? {
                phase: 'complete',
                winner: 'north_south',
                trump: 'hearts',
                hand_number: 5,
                current_player: null,
                players: {
                  north: { hand: 0 },
                  east: { hand: 0 },
                  west: { hand: 0 },
                  south: { hand: [] },
                },
              }
            : {}),
        },
      ],
    ];
    store.reset();
    store.initFromRoom({ room: DRAW_ROOM, youPlayerId: 'p-south' });
    store.setRole('player');
    store.setYouPosition('south');
    store.setChannelStatus(true);
    store.setLegalActions([]);
    const timers = frames.map(([at, state]) =>
      setTimeout(() => store.setServerState(state as unknown as ServerGameState), at)
    );
    timers.push(setTimeout(() => setRun((n) => n + 1), 1500 + handResultTiming.showMs + 6_000));
    return () => timers.forEach(clearTimeout);
  }, [Table, run, result]);

  return (
    <View style={{ flex: 1 }}>
      {Table ? (
        <Table key={run} room={DRAW_ROOM} rulesFixtureSeen onLeave={() => {}} />
      ) : (
        <Loading />
      )}
      {result !== 'game-over' ? <HandResultTuner onReplay={() => setRun((n) => n + 1)} /> : null}
    </View>
  );
}
