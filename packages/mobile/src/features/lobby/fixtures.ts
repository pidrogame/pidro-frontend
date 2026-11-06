import { emptyLobbyCategories, POSITION_TO_INDEX } from '@pidro/shared';
import type { LobbyCategories, Position, Room, SeatInvitation } from '@pidro/shared';
import { friendNoticeFixture } from '../friends/fixtures';
import { answerEntry, emptyEntry, type PasswordEntry } from './passwordSeat';

export function seatInvitationsFixture(value?: string): SeatInvitation[] | undefined {
  // The seat notice's own invitation, which Home lists only once the notice has gone.
  if (__DEV__ && (value === 'friend-seat' || value === 'friend-offline'))
    return friendNoticeFixture(value)?.flatMap((n) => (n.kind === 'seat' ? [n.invitation] : []));
  if (!__DEV__ || value !== 'invitations') return;
  return [
    {
      code: 'NORA',
      position: 'south',
      host_id: 'nora',
      host: { user_id: 'nora', display_name: 'Nora', avatar_url: null },
      rule_set: 'finnish',
      held_since: '2026-10-15T12:00:00Z',
    },
    {
      code: 'KALLE',
      position: 'east',
      host_id: 'kalle',
      host: { user_id: 'kalle', display_name: 'Kalle', avatar_url: null },
      rule_set: 'louisiana',
      held_since: '2026-10-15T12:01:00Z',
    },
  ];
}

/** The bot crew, in the order the server hands them out at a table. */
export const BOT_CREW = [
  { bot_persona: 'marcel', username: 'Marcel', display_name: 'Marcel' },
  { bot_persona: 'antti', username: 'Antti', display_name: 'Antti' },
  { bot_persona: 'jocke', username: 'Jocke', display_name: 'Jocke' },
] as const;

/** The chips the rows show: two Legends, the rest by the length of the name. */
const fixtureLevel = (name: string) =>
  name === 'Claas'
    ? { level: 100, prestige: 4 }
    : name === 'Kalle'
      ? { level: 100, prestige: 0 }
      : { level: (name.length * 11) % 97, prestige: 0 };

/** `Bot` in `names` seats the next of the crew. */
function room(code: string, names: (string | null)[], louisiana = false, playing = false): Room {
  const positions: Position[] = ['north', 'south', 'east', 'west'];
  let bots = 0;
  return {
    code,
    name: 'Never show this table name',
    host_id: `${code}-north`,
    status: playing ? 'playing' : 'waiting',
    config: {
      rule_set: louisiana ? 'louisiana' : 'finnish',
      name: null,
      bot_difficulty: 'basic',
      solo: false,
    },
    seats: names.map((name, index) => ({
      position: positions[index],
      seat_index: POSITION_TO_INDEX[positions[index]],
      status: name ? 'occupied' : 'free',
      player: name
        ? {
            id: `${code}-${positions[index]}`,
            ...(name === 'Bot'
              ? { is_bot: true, ...BOT_CREW[bots++ % 3] }
              : { username: name, ...fixtureLevel(name) }),
          }
        : null,
    })),
    available_positions: positions.filter((_, index) => !names[index]),
  };
}

/** `password` is Tables with a locked chair; the others open its keypad in one state. */
const PASSWORD_FIXTURES: Record<string, PasswordEntry | null> = {
  password: null,
  'password-keypad': emptyEntry,
  'password-typed': { digits: '48', status: 'typing' },
  'password-wrong': answerEntry('wrong'),
  'password-wait': answerEntry('wait'),
};

export function lobbyFixture(value?: string):
  | {
      lobby: LobbyCategories;
      query: string;
      gamesPlayed: number;
      password?: { code: string; position: Position; initial: PasswordEntry };
      /** Start a table while seated at MY: the web's stand-in for the native alert. */
      atTable?: boolean;
    }
  | undefined {
  if (
    !__DEV__ ||
    ![
      'list',
      'badges',
      'locked',
      'empty',
      'rejoin',
      'open',
      'substitute',
      'watch',
      'search-empty',
      'held',
      'invitations',
      'at-table',
      ...Object.keys(PASSWORD_FIXTURES),
    ].includes(value ?? '')
  )
    return;
  const lobby: LobbyCategories = {
    my_rejoinable: [room('MY', ['You', 'Nora', 'Kalle', 'Mikko'], false, true)],
    open_tables: [
      room('OPEN1', ['Claas', null, null, null]),
      room('OPEN2', ['Yaya', null, 'Bot', null], true),
      room('OPEN3', ['Shirlee', null, 'Thenutz', 'Bot']),
      room('OPEN4', ['Maija', 'Matti', null, null]),
      room('OPEN5', ['Erkki', null, 'Sanna', null]),
      room('OPEN6', ['Heikki', null, null, null]),
    ],
    substitute_needed: [room('SUB', ['Anna', 'Pekka', null, 'Liisa'], false, true)],
    spectatable: [
      room('WATCH1', ['Kalle', 'Eero', 'Hanna', 'Olli'], false, true),
      room('WATCH2', ['Ritva', 'Bot', 'Bot', 'Bot'], true, true),
      room('WATCH3', ['Juha', 'Lasse', 'Matti', 'Antti'], false, true),
    ],
  };
  for (const [index, minimum] of [
    [0, 100],
    [2, 1000],
    [3, 1000],
    [4, 100],
  ]) {
    for (const seat of lobby.open_tables[index].seats ?? []) {
      if (seat.status === 'free') seat.min_games = minimum;
    }
  }
  lobby.substitute_needed[0].game = { hand: 3, scores: { north_south: 12, east_west: 9 } };
  lobby.substitute_needed[0].seats!.find((seat) => seat.status === 'free')!.vacated_by = 'Jussi';
  lobby.spectatable[0].game = { hand: 4, scores: { north_south: 34, east_west: 21 } };
  if (value === 'held') {
    lobby.open_tables[0].seats!.find((seat) => seat.position === 'south')!.held_for = {
      user_id: 'nora',
      display_name: 'Nora',
      avatar_url: null,
    };
  }
  const keypad = PASSWORD_FIXTURES[value ?? ''];
  if (keypad !== undefined) {
    const locked = room('LOCK', ['Bertil', null, 'Hanna', 'Bot']);
    locked.seats![1].password = true;
    lobby.open_tables.splice(1, 0, locked);
  }
  const categories: Record<string, keyof LobbyCategories> = {
    rejoin: 'my_rejoinable',
    open: 'open_tables',
    badges: 'open_tables',
    locked: 'open_tables',
    held: 'open_tables',
    invitations: 'open_tables',
    'at-table': 'open_tables',
    ...Object.fromEntries(Object.keys(PASSWORD_FIXTURES).map((key) => [key, 'open_tables'])),
    substitute: 'substitute_needed',
    watch: 'spectatable',
  };
  const category = categories[value ?? ''];
  return {
    lobby:
      value === 'empty'
        ? emptyLobbyCategories()
        : category
          ? { ...emptyLobbyCategories(), [category]: lobby[category] }
          : lobby,
    query: value === 'search-empty' ? 'Nobody named this' : '',
    gamesPlayed: value === 'locked' ? 40 : 1500,
    ...(keypad ? { password: { code: 'LOCK', position: 'south' as const, initial: keypad } } : {}),
    atTable: value === 'at-table',
  };
}
