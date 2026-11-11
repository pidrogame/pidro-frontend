import type {
  BlockedPlayers,
  FriendLists,
  FriendNotice,
  FriendPlayer,
  FriendResult,
} from '@pidro/shared';

/** Dated from now, so the words read the same on every day; months need a fixed date. */
function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

const players: FriendResult[] = [
  {
    user_id: 'nora',
    display_name: 'Nora',
    avatar_url: null,
    level: 44,
    prestige: 0,
    presence: 'online',
    relation: 'none',
  },
  {
    user_id: 'pekka',
    display_name: 'Pekka',
    avatar_url: null,
    level: 100,
    prestige: 12,
    presence: 'at_table',
    relation: 'friend',
  },
  {
    user_id: 'liisa',
    display_name: 'Liisa',
    avatar_url: null,
    level: 100,
    prestige: 0,
    presence: 'offline',
    relation: 'added_you',
  },
  {
    user_id: 'kalle',
    display_name: 'Kalle',
    avatar_url: null,
    level: 7,
    prestige: 0,
    presence: 'offline',
    relation: 'added',
  },
];

export function friendsFixture(value?: string): FriendLists | undefined {
  if (
    __DEV__ &&
    [
      'sheet-partner',
      'sheet-opponent',
      'sheet-full',
      'sheet-online',
      'sheet-bots',
      'sheet-offline',
      'sheet-request',
      'sheet-remove',
      'sheet-block',
    ].includes(value ?? '')
  ) {
    const presence =
      value === 'sheet-offline' ? 'offline' : value === 'sheet-online' ? 'online' : 'at_table';
    const player: FriendResult = {
      ...players[0],
      presence,
      table_company: value === 'sheet-bots' ? 'bots' : undefined,
      join_as:
        value === 'sheet-partner' ? 'partner' : value === 'sheet-opponent' ? 'opponent' : null,
    };
    return {
      friends: value === 'sheet-request' ? [] : [player],
      added_you: value === 'sheet-request' ? [player] : [],
    };
  }
  if (
    !__DEV__ ||
    !['empty', 'list', 'all', 'added-you', 'loading', 'error', 'classic', 'link-profile'].includes(
      value ?? ''
    )
  )
    return;
  if (value === 'link-profile') return { friends: players.slice(1, 3), added_you: [] };
  const nora: FriendResult = {
    ...players[0],
    presence: 'at_table',
    table_company: 'people',
    join_as: 'partner',
    table_open_seats: 1,
    table_hand: 2,
  };
  const kalle: FriendResult = {
    ...players[3],
    presence: 'at_table',
    table_company: 'people',
    join_as: null,
    table_open_seats: 0,
    table_hand: 4,
  };
  const maija: FriendResult = { ...players[0], user_id: 'maija', display_name: 'Maija' };
  const hanna: FriendResult = {
    ...players[2],
    user_id: 'hanna',
    display_name: 'Hanna',
    played_together_at: daysAgo(1),
  };
  const eero = {
    ...players[3],
    user_id: 'eero',
    display_name: 'Eero',
    requested_at: daysAgo(2),
  };
  const pekka = { ...players[1], requested_at: daysAgo(0) };
  if (value === 'all')
    return {
      friends: [nora, kalle, maija, hanna],
      added_you: [pekka],
      requests_waiting: 1,
      requested: [eero],
      classic: { not_here: 38 },
    };
  if (value === 'list')
    return {
      friends: [
        nora,
        kalle,
        maija,
        hanna,
        { ...hanna, user_id: 'mikko', display_name: 'Mikko', played_together_at: daysAgo(8) },
        {
          ...hanna,
          user_id: 'sanna',
          display_name: 'Sanna',
          // Reads "in September" until September 2027, when the year joins it: refresh then.
          played_together_at: '2026-09-12T12:00:00Z',
        },
      ],
      added_you: [pekka, { ...players[2], requested_at: daysAgo(3) }],
      requests_waiting: 2,
      requested: [eero],
    };
  return {
    friends: ['empty', 'loading', 'error'].includes(value ?? '') ? [] : players.slice(0, 3),
    added_you: value === 'added-you' ? [players[3]] : [],
    ...(['classic', 'empty'].includes(value ?? '')
      ? { classic: { not_here: value === 'empty' ? 38 : 7 } }
      : {}),
  };
}

/** Nora's profile as her link opens it for someone who is not her friend yet. */
export function linkProfileFixture(value?: string): FriendPlayer | null {
  return __DEV__ && value === 'link-profile' ? players[0] : null;
}

export function discoveryFixture(value?: string): FriendResult[] | undefined {
  if (!__DEV__ || !['recent', 'results', 'empty'].includes(value ?? '')) return;
  const sanna = {
    ...players[0],
    user_id: 'sanna',
    display_name: 'Sanna',
    played_together_at: daysAgo(0),
  };
  const erkki = {
    ...players[0],
    user_id: 'erkki',
    display_name: 'Erkki',
    presence: 'offline' as const,
    played_together_at: daysAgo(1),
  };
  if (value === 'empty')
    return [
      sanna,
      erkki,
      { ...erkki, user_id: 'ville', display_name: 'Ville', played_together_at: daysAgo(2) },
    ];
  if (value === 'recent')
    return [
      sanna,
      { ...players[1], display_name: 'Nora', played_together_at: daysAgo(1) },
      { ...players[2], display_name: 'Pekka', played_together_at: daysAgo(2) },
      { ...players[3], display_name: 'Eero', played_together_at: daysAgo(3) },
    ];
  return players.map((player, index) => ({
    ...player,
    display_name: ['Nora', 'Norbert', 'Noreen', 'Norman'][index],
  }));
}

export function blockedFixture(value?: string): BlockedPlayers | undefined {
  if (!__DEV__ || !['empty', 'filled', 'loading', 'error'].includes(value ?? '')) return;
  return {
    blocked:
      value === 'filled'
        ? players.slice(0, 2).map(({ user_id, display_name, avatar_url }) => ({
            user_id,
            display_name,
            avatar_url,
          }))
        : [],
  };
}

export function friendNoticeFixture(value?: string): FriendNotice[] | undefined {
  if (
    !__DEV__ ||
    ![
      'friend-request',
      'friend-accepted',
      'friend-linked',
      'friend-seat',
      'friend-offline',
      'friend-queue',
      'friend-too-late',
      'friend-premium-carried',
      'friend-premium-ended',
    ].includes(value ?? '')
  )
    return;
  const request: FriendNotice = {
    kind: 'request',
    player: players[1],
    played_together_at: daysAgo(1),
  };
  const accepted: FriendNotice = { kind: 'accepted', player: players[0], source: 'accept' };
  const seat: FriendNotice = {
    kind: 'seat',
    invitation: {
      code: 'NOTICE',
      position: 'north',
      host_id: 'kalle',
      host: players[3],
      rule_set: 'finnish',
      join_as: 'partner',
    },
  };
  if (value === 'friend-queue') return [accepted, request, seat];
  if (value === 'friend-linked') return [{ kind: 'sent', player: players[0] }];
  if (value === 'friend-too-late') return [{ kind: 'too_late', invitation: seat.invitation }];
  if (value === 'friend-premium-carried')
    return [
      { kind: 'classic_premium', premium: { state: 'carried', until: '2027-03-12T12:00:00Z' } },
    ];
  if (value === 'friend-premium-ended')
    return [
      { kind: 'classic_premium', premium: { state: 'ended', until: '2026-03-12T12:00:00Z' } },
    ];
  return [value === 'friend-request' ? request : value === 'friend-accepted' ? accepted : seat];
}
