import { emptyLobbyCategories, POSITION_TO_INDEX } from '@pidro/shared';
import type { BotProfile, LobbyCategories, Position, Room, SeatInvitation } from '@pidro/shared';
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

/** `character=saga` (PID-405): a catalogue character at North who plays the odds, in its own words. */
export const BOT_CHARACTER = {
  bot_persona: '1c477a6a-fb56-4b4f-a6b5-3b1390c60102',
  username: 'Saga',
  display_name: 'Saga',
  bot_profile: {
    id: '1c477a6a-fb56-4b4f-a6b5-3b1390c60102',
    name: 'Saga',
    description: 'New at the table, quick with a count.',
    avatar_url: 'https://fixture.invalid/images/bots/antti.svg',
    strategy: 'search',
    tempo: 'steady',
    home: 'finland' as const,
    // The last is as long as the catalogue allows: the nameplate cuts it short.
    lines: ['Nå, nå…', 'Tja…', 'Hmm, hmm…', 'Jaha…', 'Hmmm… nå… jaha… tja… hmm… nå… jaha… tja…'],
  },
};

/**
 * The fifteen of `GET /api/v1/bots` (PID-410's New table fixtures), as production sent them on
 * 2026-11-09. The host is a stand-in: portraits other than the club's own three draw neutral.
 */
export const BOT_CATALOGUE: BotProfile[] = [
  {
    id: 'antti',
    name: 'Antti',
    description: '',
    avatar_url: 'https://fixture.invalid/images/bots/antti.svg',
    strategy: 'search',
    tempo: 'slow',
    home: 'anywhere',
  },
  {
    id: 'jocke',
    name: 'Jocke',
    description: '',
    avatar_url: 'https://fixture.invalid/images/bots/jocke.svg',
    strategy: 'search',
    tempo: 'steady',
    home: 'anywhere',
  },
  {
    id: 'marcel',
    name: 'Marcel',
    description: '',
    avatar_url: 'https://fixture.invalid/images/bots/marcel.svg',
    strategy: 'search',
    tempo: 'quick',
    home: 'anywhere',
  },
  {
    id: 'alcide',
    name: 'Alcide',
    description:
      'Mamou. Accordion player. Thinks in waltz time, says little, and tends to take the last trick.',
    avatar_url:
      'https://fixture.invalid/api/v1/bots/alcide/avatar/fb2cc962726620066244301f871ad24520bac5e9305f6542ea77b8736d590830',
    strategy: 'rulebook',
    tempo: 'slow',
    home: 'louisiana',
  },
  {
    id: 'beau',
    name: 'Beau',
    description:
      'Lafayette. Welder, plays on his lunch break. Quick to bid, and quick to laugh when it goes wrong.',
    avatar_url:
      'https://fixture.invalid/api/v1/bots/beau/avatar/15dc824efcb8a3ca8a0a6d4c4e7990db81ac64115b567a58b91d888a3da78330',
    strategy: 'rulebook',
    tempo: 'quick',
    home: 'louisiana',
  },
  {
    id: 'bengt',
    name: 'Bengt',
    description:
      'Vasa. Retired harbour pilot. Has played at the same table every Thursday since 1979 and still keeps the score by hand.',
    avatar_url:
      'https://fixture.invalid/api/v1/bots/bengt/avatar/e7c7f444f6987c5e5f5e813c14c668940ffd84db43481cb05453f5031f6c5b44',
    strategy: 'rulebook',
    tempo: 'slow',
    home: 'finland',
  },
  {
    id: 'celeste',
    name: 'Celeste',
    description:
      'Thibodaux. Runs the Sunday table and the kitchen. Knows what her partner holds before he does.',
    avatar_url:
      'https://fixture.invalid/api/v1/bots/celeste/avatar/5999a235eba9fff7db6cdc70ee834404e60e68347204736467ff8705a1ec5d0b',
    strategy: 'rulebook',
    tempo: 'steady',
    home: 'louisiana',
  },
  {
    id: 'delphine',
    name: 'Delphine',
    description:
      'New Iberia. Schoolteacher. Quick bids, a straight face, and a laugh you can hear from the porch.',
    avatar_url:
      'https://fixture.invalid/api/v1/bots/delphine/avatar/bb929021e742b6a6bac947ba35d3985529400d109f4a948f0fb87d8758db2aba',
    strategy: 'rulebook',
    tempo: 'quick',
    home: 'louisiana',
  },
  {
    id: 'gosta',
    name: 'Gösta',
    description:
      'Närpes. Grows tomatoes. Patient, says little, and backs his partner to the last card.',
    avatar_url:
      'https://fixture.invalid/api/v1/bots/gosta/avatar/ee5e42f34700d432fc39446dfc56e1caf91cf9d186a3f011fe9532d98d578c8c',
    strategy: 'rulebook',
    tempo: 'steady',
    home: 'finland',
  },
  {
    id: 'gun',
    name: 'Gun',
    description:
      'Korsholm. Taught half the village to play at her kitchen table. Pours the coffee before the deal.',
    avatar_url:
      'https://fixture.invalid/api/v1/bots/gun/avatar/6bc18f5d8a9bb592b9a2b827944d200f9f1eda46a29e6ce470b6be7fa2563d78',
    strategy: 'rulebook',
    tempo: 'steady',
    home: 'finland',
  },
  {
    id: 'majlis',
    name: 'Maj-Lis',
    description: 'Karleby. Knits between hands and still sees your bid coming. Trusts the Ace.',
    avatar_url:
      'https://fixture.invalid/api/v1/bots/majlis/avatar/c47bb8b494150ee8dff568914c610a1d98cd8c9bd3ee876dc70812157778503d',
    strategy: 'rulebook',
    tempo: 'slow',
    home: 'finland',
  },
  {
    id: 'odile',
    name: 'Odile',
    description:
      'Eunice. Eighty-one. Waits for the right card, then plays it, and tells you why afterwards.',
    avatar_url:
      'https://fixture.invalid/api/v1/bots/odile/avatar/b3f1edb908e14317c5a8992c631e50e5d7911a827536278779faaca03fc34df4',
    strategy: 'rulebook',
    tempo: 'slow',
    home: 'louisiana',
  },
  {
    id: 'remy',
    name: 'Remy',
    description:
      'Breaux Bridge. Cooks crawfish on Saturdays and plays cards after. Never hurries, never forgets a trump.',
    avatar_url:
      'https://fixture.invalid/api/v1/bots/remy/avatar/d36658c61462caee662d2d5a7a5b1bc4f06a0c98c975c4b10af410bf7c7f3bf9',
    strategy: 'rulebook',
    tempo: 'steady',
    home: 'louisiana',
  },
  {
    id: 'siv',
    name: 'Siv',
    description: 'Kristinestad. Pharmacist. Remembers every card thrown and never bids on hope.',
    avatar_url:
      'https://fixture.invalid/api/v1/bots/siv/avatar/12d111858df94e5eb8d7c03c4089567a0dacf7c1d57b2ddb61b3f9ad4a3ff9d7',
    strategy: 'rulebook',
    tempo: 'quick',
    home: 'finland',
  },
  {
    id: 'stig',
    name: 'Stig',
    description:
      'Jakobstad. Boat builder. Plays fast and bids early, then looks out of the window while you think.',
    avatar_url:
      'https://fixture.invalid/api/v1/bots/stig/avatar/31e1e13aba1ad25e0aae5274e49a8f6bbb39327bf8e5530b0a39d19891ee9728',
    strategy: 'rulebook',
    tempo: 'quick',
    home: 'finland',
  },
];

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
