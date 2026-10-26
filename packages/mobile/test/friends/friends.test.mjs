import { afterEach, describe, expect, test } from 'bun:test';
import {
  createAuthApi,
  createClassicApi,
  localizedError,
  setLocale,
  useFriendsStore,
} from '@pidro/shared';
import {
  canSearch,
  canViewPlayer,
  classicFriendsMessage,
  friendAction,
  friendRowState,
  friendSections,
  friendSheetState,
  friendsMeta,
  discoveryRowState,
  followFriendLists,
  friendLinkMessage,
  friendLinkRequest,
  linkProfileAction,
} from '../../src/features/friends/index.ts';

afterEach(() => {
  setLocale('en');
  useFriendsStore.getState().reset();
});

describe('Friends presentation', () => {
  test('the short profile offers the one next step, using only the server seat permission', () => {
    const nora = { user_id: 'nora', display_name: 'Nora', avatar_url: null };
    for (const table_company of [undefined, 'people', 'bots']) {
      const presence = 'at_table';
      expect(
        friendSheetState({ ...nora, presence, table_company, join_as: 'partner' })
      ).toMatchObject({
        action: 'join',
        label: 'Join Nora’s table',
        line: 'At a table · partner seat free',
        hint: 'You’ll play as Nora’s partner.',
        tone: 'gold',
      });
      expect(
        friendSheetState({ ...nora, presence, table_company, join_as: 'opponent' })
      ).toMatchObject({
        action: 'join',
        hint: 'You’ll play against Nora.',
      });
    }
    for (const entry of [
      { presence: 'at_table', table_open_seats: 3 },
      { presence: 'at_table', table_company: 'people' },
      { presence: 'at_table', table_company: 'people', join_as: null },
    ])
      expect(friendSheetState({ ...nora, ...entry })).toMatchObject({
        action: null,
        label: null,
        hint: null,
        line: 'At a table · no free seats',
      });
    for (const entry of [{ presence: 'online' }, { presence: 'at_table', table_company: 'bots' }])
      expect(friendSheetState({ ...nora, ...entry })).toMatchObject({
        action: 'play',
        label: 'Play together',
        hint: 'Starts a new table with Nora as your partner.',
      });
    for (const entry of [{ presence: 'offline' }, {}])
      expect(friendSheetState({ ...nora, ...entry })).toMatchObject({
        action: 'play',
        hint: 'Your invitation waits for Nora in Pidro.',
      });
    expect(
      friendSheetState({ ...nora, presence: 'at_table', join_as: 'partner' }, 'added_you')
    ).toMatchObject({
      action: 'accept',
      label: 'Accept',
      hint: null,
    });
    // A request you sent is theirs to answer: nothing to start with them yet.
    for (const presence of ['online', 'offline'])
      expect(friendSheetState({ ...nora, presence }, 'added')).toMatchObject({
        action: null,
        label: null,
        hint: null,
        line: 'Request sent',
      });
    setLocale('sv');
    expect(friendSheetState({ ...nora, presence: 'at_table', join_as: 'opponent' })).toMatchObject({
      label: 'Gå med vid Noras bord',
      hint: 'Du spelar mot Nora.',
    });
  });

  test('Classic copy uses only a positive server count, with singular and plural wording', () => {
    const lists = { friends: [], added_you: [] };
    expect(classicFriendsMessage(lists)).toBeNull();
    expect(classicFriendsMessage({ ...lists, classic: { not_here: 0 } })).toBeNull();
    expect(classicFriendsMessage({ ...lists, classic: { not_here: 1 } })).toBe(
      '1 friend from your old Pidro app isn’t here yet'
    );
    expect(classicFriendsMessage({ ...lists, classic: { not_here: 7 } })).toBe(
      '7 friends from your old Pidro app aren’t here yet'
    );
    setLocale('sv');
    expect(classicFriendsMessage({ ...lists, classic: { not_here: 7 } })).toBe(
      '7 vänner från din gamla Pidro-app är inte här än'
    );
  });

  test('Classic metadata follows friend responses, survives block updates, and clears on reset', () => {
    const store = useFriendsStore.getState();
    const lists = { friends: [], added_you: [], classic: { not_here: 7 } };
    store.setLists(lists);
    store.setLists({ blocked: [] });
    expect(useFriendsStore.getState().classic).toEqual({ not_here: 7 });
    store.setLists({ ...lists, classic: { not_here: 0 } });
    expect(classicFriendsMessage(useFriendsStore.getState())).toBeNull();
    store.setLists(lists);
    store.setLists({ friends: [], added_you: [] });
    expect(useFriendsStore.getState().classic).toBeUndefined();
    store.setLists(lists);
    store.reset();
    expect(useFriendsStore.getState().classic).toBeUndefined();
  });

  test('human seats open profiles, but empty and bot seats do not', () => {
    for (const seatStatus of ['normal', 'reconnecting', 'bot_substitute']) {
      expect(canViewPlayer({ playerId: 'nora', seatStatus })).toBe(true);
      expect(canViewPlayer({ playerId: 'bot_ROOM_north', seatStatus })).toBe(false);
    }
    for (const seatStatus of ['vacant', 'permanent_bot']) {
      expect(canViewPlayer({ playerId: 'nora', seatStatus })).toBe(false);
    }
    expect(canViewPlayer({ playerId: null, seatStatus: 'normal' })).toBe(false);
  });

  test('requests, online, offline and sent keep their server order and omit empty sections', () => {
    const lists = {
      friends: [
        { user_id: 'z', display_name: 'Zoe', avatar_url: null, presence: 'at_table' },
        { user_id: 'a', display_name: 'Anna', avatar_url: null, presence: 'offline' },
      ],
      added_you: [{ user_id: 'n', display_name: 'Nora', avatar_url: null, presence: 'online' }],
      requested: [
        {
          user_id: 'e',
          display_name: 'Eero',
          presence: 'offline',
          requested_at: '2026-10-17T12:00:00Z',
        },
      ],
    };
    expect(
      friendSections(lists).map(({ key, players }) => [key, players.map((p) => p.user_id)])
    ).toEqual([
      ['requests', ['n']],
      ['online', ['z']],
      ['offline', ['a']],
      ['sent', ['e']],
    ]);
    expect(
      friendSections({ friends: lists.friends, added_you: [] }).map((section) => section.title)
    ).toEqual(['Online now', 'Not online']);
    expect(friendsMeta(lists)).toBe('2 friends · 1 online');
    expect(friendSections({ friends: [], added_you: [] })).toEqual([]);
    const cause = { error_code: 'profile_unavailable' };
    useFriendsStore.getState().setLists(lists);
    useFriendsStore.getState().setError(cause);
    for (const locale of ['sv', 'en']) {
      setLocale(locale);
      const sections = friendSections(useFriendsStore.getState());
      expect(sections.map((section) => section.title)).toEqual(
        locale === 'sv'
          ? ['Vill bli vänner', 'Online nu', 'Inte online', 'Väntar på svar']
          : ['Want to be friends', 'Online now', 'Not online', 'Waiting for an answer']
      );
      expect(sections[1].players[0].display_name).toBe('Zoe');
      expect(useFriendsStore.getState().error).toBe(cause);
      expect(localizedError(cause, 'friends.update_failed')).toBe(
        locale === 'sv'
          ? 'Din behörighet kunde inte kontrolleras. Försök igen om en stund.'
          : 'Your eligibility could not be checked. Please try again shortly.'
      );
    }
  });

  test('Join needs server permission; only free players and bot company offer Play', () => {
    for (const join_as of ['partner', 'opponent']) {
      expect(friendAction({ presence: 'at_table', table_company: 'people', join_as })).toBe('join');
      expect(friendAction({ presence: 'at_table', table_company: 'bots', join_as })).toBe('join');
    }
    for (const entry of [{ presence: 'online' }, { presence: 'at_table', table_company: 'bots' }])
      expect(friendAction(entry)).toBe('play');
    for (const entry of [
      {},
      { presence: 'offline' },
      { presence: 'at_table', table_open_seats: 3 },
      { presence: 'at_table', table_company: 'people' },
      { presence: 'at_table', table_company: 'people', join_as: null },
    ])
      expect(friendAction(entry)).toBeNull();
  });

  test('wire dates, seats and hand feed the existing row formatter', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    expect(
      friendRowState(
        { presence: 'offline', played_together_at: '2026-10-18T12:00:00Z' },
        'friend',
        now
      ).line
    ).toBe('Played yesterday');
    expect(friendRowState({ requested_at: '2026-10-17T12:00:00Z' }, 'added', now).line).toBe(
      'Request sent 2 days ago'
    );
    expect(friendRowState({ requested_at: '2026-10-19T08:00:00Z' }, 'added_you', now).line).toBe(
      'Asked today'
    );
    expect(friendRowState({ presence: 'at_table', table_hand: 4 }).line).toBe(
      'At a table · hand 4'
    );
    expect(
      friendRowState({ presence: 'at_table', join_as: 'opponent', table_open_seats: 2 }).line
    ).toBe('At a table · 2 seats open');
  });

  test('sent requests and request count replace old lists and clear on reset', () => {
    const store = useFriendsStore.getState();
    const lists = {
      friends: [],
      added_you: [],
      requested: [{ user_id: 'sent' }],
      requests_waiting: 3,
    };
    store.setLists(lists);
    store.setLists({ blocked: [] });
    expect(useFriendsStore.getState().requested).toEqual(lists.requested);
    expect(useFriendsStore.getState().requests_waiting).toBe(3);
    store.setLists({ friends: [], added_you: [] });
    expect(useFriendsStore.getState().requested).toEqual([]);
    expect(useFriendsStore.getState().requests_waiting).toBe(0);
    store.setLists(lists);
    store.reset();
    expect(useFriendsStore.getState().requested).toEqual([]);
    expect(useFriendsStore.getState().requests_waiting).toBe(0);
    expect(localizedError({ error: 'NO_SEAT_FOR_YOU' })).toBe(
      'There is no seat available for you at this table.'
    );
  });

  test('discovery describes the relationship rather than inventing a recent-play date', () => {
    const player = { display_name: 'Sanna', presence: 'online' };
    expect(discoveryRowState({ ...player, relation: 'none' }).line).toBe('Free to play');
    expect(discoveryRowState({ ...player, relation: 'added_you' }).line).toBe(
      'Wants to be friends'
    );
    expect(discoveryRowState({ ...player, relation: 'added' }).line).toBe(
      'Waiting for Sanna to accept'
    );
    expect(discoveryRowState({ ...player, relation: 'friend' }).line).toBe('Your friend');
    setLocale('sv');
    expect(discoveryRowState({ ...player, relation: 'added' }).line).toBe(
      'Väntar på att Sanna tackar ja'
    );
  });

  test('a recent player says when you last played together, on Add and on the empty screen', () => {
    const now = new Date(2026, 9, 19, 9, 30);
    const sanna = { display_name: 'Sanna', presence: 'online', relation: 'none' };
    const on = (days, form) =>
      discoveryRowState(
        { ...sanna, played_together_at: new Date(2026, 9, 19 - days, 18).toISOString() },
        form,
        now
      );
    expect(on(0)).toMatchObject({ line: 'Played together today', tone: 'quiet', dot: 'online' });
    expect(on(1).line).toBe('Played together yesterday');
    expect(on(2).line).toBe('Played together 2 days ago');
    expect(on(0, 'day').line).toBe('Today');
    expect(on(1, 'day').line).toBe('Yesterday');
    expect(on(2, 'day').line).toBe('2 days ago');
    // A relation keeps its line; a search result has no date and keeps presence.
    const dated = { ...sanna, played_together_at: now.toISOString() };
    expect(discoveryRowState({ ...dated, relation: 'added_you' }, 'day', now).line).toBe(
      'Wants to be friends'
    );
    expect(discoveryRowState({ ...dated, relation: 'added' }, 'together', now).line).toBe(
      'Waiting for Sanna to accept'
    );
    expect(discoveryRowState({ ...dated, relation: 'friend' }, 'day', now).line).toBe(
      'Your friend'
    );
    expect(discoveryRowState(sanna, 'day', now).line).toBe('Free to play');
    expect(discoveryRowState({ ...sanna, played_together_at: null }, 'together', now).line).toBe(
      'Free to play'
    );
    setLocale('sv');
    expect(on(1).line).toBe('Spelade tillsammans igår');
    expect(on(0, 'day').line).toBe('Idag');
    expect(on(2, 'day').line).toBe('För 2 dagar sedan');
  });

  test('Add a friend follows the lists: an accepted request reads as a friend', () => {
    const row = (user_id, relation) => ({
      user_id,
      display_name: user_id,
      avatar_url: null,
      relation,
    });
    const rows = [
      row('birger', 'added'),
      row('astrid', 'none'),
      row('nora', 'added_you'),
      row('kalle', 'friend'),
    ];
    const person = (user_id) => ({ user_id, display_name: user_id, avatar_url: null });
    const followed = followFriendLists(rows, {
      friends: [person('birger'), person('nora')],
      added_you: [person('astrid')],
    });
    expect(followed.map((p) => p.relation)).toEqual(['friend', 'added_you', 'friend', 'friend']);
    expect(discoveryRowState(followed[0]).line).toBe('Your friend');
    // Lists that do not know a player yet, empty before their first answer, change nothing.
    expect(followFriendLists(rows, { friends: [], added_you: [], requested: [] })).toEqual(rows);
    expect(
      followFriendLists([row('eero', 'none')], {
        friends: [],
        added_you: [],
        requested: [person('eero')],
      })[0].relation
    ).toBe('added');
  });

  test('the sheet reads the row line for a friend who is not online', () => {
    const now = new Date(2026, 9, 19, 9, 30);
    const nora = { user_id: 'nora', display_name: 'Nora', avatar_url: null, presence: 'offline' };
    expect(
      friendSheetState(
        { ...nora, played_together_at: new Date(2026, 9, 18, 22).toISOString() },
        'friend',
        now
      ).line
    ).toBe('Played yesterday');
    expect(friendSheetState({ ...nora, played_together_at: null }).line).toBe('Not online');
    expect(
      friendSheetState({
        ...nora,
        presence: 'at_table',
        join_as: 'partner',
        table_open_seats: 2,
      }).line
    ).toBe('At a table · partner seat free');
  });

  test('your link message uses your slug, with an app-home fallback and the current language', () => {
    expect(friendLinkMessage('sanna-7KQ')).toEqual({
      url: 'https://pidro.online/play/sanna-7KQ',
      message: 'Come play Pidro with me: https://pidro.online/play/sanna-7KQ',
    });
    for (const slug of [undefined, null, ''])
      expect(friendLinkMessage(slug)).toEqual({
        url: 'https://pidro.online',
        message: 'Come play Pidro with me: https://pidro.online',
      });
    setLocale('sv');
    expect(friendLinkMessage('pekka').message).toBe(
      'Kom och spela Pidro med mig: https://pidro.online/play/pekka'
    );
  });

  test('search waits for three normalized characters, excluding edge whitespace', () => {
    expect(canSearch(' no ')).toBe(false);
    expect(canSearch(' nor ')).toBe(true);
    expect(canSearch('a\u0308o')).toBe(false);
    expect(canSearch('a\u0308or')).toBe(true);
    expect(canSearch('😀a')).toBe(false);
    expect(canSearch('ﬃ')).toBe(true);
  });
});

describe("Someone's own link", () => {
  const ageTerms = { age_band: '18_plus', terms_version: '1' };
  const bertil = { slug: 'bertil', displayName: 'Bertil', receivedAt: 1 };

  async function bodies(link) {
    const calls = [];
    const api = {
      post: async (path, body) => {
        calls.push([path, body]);
        return { status: 200, data: { data: { token: 't', user: { id: 'u' } } } };
      },
    };
    const extras = { ...ageTerms, ...friendLinkRequest(link) };
    const auth = createAuthApi(api);
    await auth.register('Sanna', 'sanna@example.com', 'secret123', extras);
    await auth.upgradeGuest('Sanna', 'sanna@example.com', 'secret123', extras);
    await auth.providerLogin('apple', { type: 'identity_token', token: 'apple' }, 'i-1', extras);
    await createClassicApi(api).claim({ ticket: 'tk', install_id: 'i-1', ...extras });
    return calls;
  }

  test('sign-up bodies carry friend_slug only while a link is pending', async () => {
    expect(friendLinkRequest(null)).toEqual({});
    expect(await bodies(null)).toEqual([
      [
        '/api/v1/auth/register',
        {
          user: { username: 'Sanna', email: 'sanna@example.com', password: 'secret123' },
          ...ageTerms,
        },
      ],
      [
        '/api/v1/auth/upgrade',
        { username: 'Sanna', email: 'sanna@example.com', password: 'secret123', ...ageTerms },
      ],
      ['/api/v1/auth/apple', { identity_token: 'apple', install_id: 'i-1', ...ageTerms }],
      ['/api/v1/classic/claim', { ticket: 'tk', install_id: 'i-1', ...ageTerms }],
    ]);

    const linked = await bodies(bertil);
    expect(linked.map(([, body]) => body.friend_slug)).toEqual([
      'bertil',
      'bertil',
      'bertil',
      'bertil',
    ]);
    expect(linked.map(([, body]) => JSON.stringify(body))).toEqual(
      (await bodies(null)).map(([, body]) => JSON.stringify({ ...body, friend_slug: 'bertil' }))
    );
  });

  test('the profile a link opens offers Add, Sent, or nothing for a friend or yourself', () => {
    const lists = {
      friends: [{ user_id: 'nora' }],
      requested: [{ user_id: 'kalle' }],
    };
    expect(linkProfileAction(lists, 'bertil', 'me')).toBe('add');
    expect(linkProfileAction(lists, 'kalle', 'me')).toBe('sent');
    expect(linkProfileAction(lists, 'nora', 'me')).toBeNull();
    expect(linkProfileAction(lists, 'me', 'me')).toBeNull();
    expect(linkProfileAction({ friends: [] }, 'bertil', 'me')).toBe('add');
  });
});
