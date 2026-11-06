import {
  t,
  formatNumber,
  type FriendLinkRequest,
  type FriendLists,
  type FriendPlayer,
  type FriendResult,
  type PendingFriendLink,
  type RelativePlayerView,
} from '@pidro/shared';
import { relativeDay } from '../relativeDay';

export function friendSections(lists: FriendLists) {
  return [
    {
      key: 'requests',
      title: t('friends.want_to_be_friends'),
      players: lists.added_you,
      relation: 'added_you' as const,
    },
    {
      key: 'online',
      title: t('friends.online_now'),
      players: lists.friends.filter(isOnline),
      relation: 'friend' as const,
    },
    {
      key: 'offline',
      title: t('friends.not_online'),
      players: lists.friends.filter((friend) => !isOnline(friend)),
      relation: 'friend' as const,
    },
    {
      key: 'sent',
      title: t('friends.waiting_answer'),
      players: lists.requested ?? [],
      relation: 'added' as const,
    },
  ].filter((section) => section.players.length > 0);
}

function isOnline(friend: FriendEntry) {
  return friend.presence !== undefined && friend.presence !== 'offline';
}

export function friendAction(friend: FriendEntry): 'join' | 'play' | null {
  if (!isOnline(friend)) return null;
  if (friend.join_as) return 'join';
  if (
    friend.presence === 'online' ||
    (friend.presence === 'at_table' && friend.table_company === 'bots')
  )
    return 'play';
  return null;
}

export function friendSheetState(
  entry: FriendEntry,
  relation: FriendRelation = 'friend',
  now: Date = new Date()
) {
  const row = friendRowState(entry, relation, now);
  const params = { name: entry.display_name };
  if (relation === 'added_you')
    return { ...row, action: 'accept' as const, label: t('friends.accept'), hint: null };
  if (relation === 'added') return { ...row, action: null, label: null, hint: null };
  const action = friendAction(entry);
  if (action === 'join')
    return {
      ...row,
      action,
      dot: 'table' as const,
      tone: 'gold' as const,
      line: t(
        entry.join_as === 'partner' ? 'friend_sheet.partner_status' : 'friend_sheet.opponent_status'
      ),
      label: t('friend_sheet.join', params),
      hint: t(
        entry.join_as === 'partner' ? 'friend_sheet.partner_hint' : 'friend_sheet.opponent_hint',
        params
      ),
    };
  if (action === 'play' || !isOnline(entry))
    return {
      ...row,
      action: 'play' as const,
      label: t('friend_sheet.play'),
      hint: t(isOnline(entry) ? 'friend_sheet.online_hint' : 'friend_sheet.offline_hint', params),
    };
  return { ...row, action: null, line: t('friend_sheet.full_status'), label: null, hint: null };
}

export function friendsMeta(lists: FriendLists) {
  const count = lists.friends.length;
  return t('friends.meta', {
    friends: t('friends.count', { count, number: formatNumber(count) }),
    online: formatNumber(lists.friends.filter(isOnline).length),
  });
}

export function classicFriendsMessage(lists: FriendLists): string | null {
  const count = lists.classic?.not_here ?? 0;
  return count > 0 ? t('friends.classic_not_here', { count, number: formatNumber(count) }) : null;
}

export function canSearch(query: string) {
  // Hermes has no Segmenter. The server checks the exact grapheme minimum.
  return Array.from(query.normalize('NFKC').trim()).length >= 3;
}

export function canViewPlayer(player: Pick<RelativePlayerView, 'playerId' | 'seatStatus'>) {
  // A substitute keeps the reserved human's ID; actual bots have bot_ IDs.
  return (
    !!player.playerId &&
    !player.playerId.startsWith('bot_') &&
    player.seatStatus !== 'permanent_bot' &&
    player.seatStatus !== 'vacant'
  );
}

/** A friends-list entry as a row reads it. Everything past the name is optional. */
export type FriendEntry = Omit<FriendPlayer, 'presence'> & {
  presence?: FriendPlayer['presence'];
};

/** Where the entry stands with you: as `FriendResult.relation`, plus a friend made just now. */
export type FriendRelation = FriendResult['relation'] | 'new_friend';

/** Where a friend installs the new Pidro; the bare site only offers Classic. */
export const APP_INSTALL_URL = 'https://www.pidro.online/beta';

/** On www: Android won't verify App Links for the bare domain, which redirects there. */
export function friendLinkMessage(slug?: string | null) {
  const url = slug ? `https://www.pidro.online/play/${slug}` : APP_INSTALL_URL;
  return { url, message: t('friends.share_link_message', { url }) };
}

/** `friend_slug` for a sign-up, only while someone's link is pending; otherwise nothing. */
export function friendLinkRequest(link: PendingFriendLink | null): FriendLinkRequest {
  return link ? { friend_slug: link.slug } : {};
}

/** What a profile opened from someone's link offers: Add, Sent, or nothing for a friend or yourself. */
export function linkProfileAction(
  lists: Pick<FriendLists, 'friends' | 'requested'>,
  playerId: string,
  userId: string | undefined
): 'add' | 'sent' | null {
  if (playerId === userId || lists.friends.some((p) => p.user_id === playerId)) return null;
  return lists.requested?.some((p) => p.user_id === playerId) ? 'sent' : 'add';
}

/**
 * A row on Add a friend or the empty Friends screen. A recent player you
 * have no relation with says when you last played: "Played together
 * yesterday" on Add, the bare "Yesterday" on the empty screen.
 */
export function discoveryRowState(
  player: FriendResult,
  form: 'together' | 'day' = 'together',
  now: Date = new Date()
): FriendRowState {
  const row = friendRowState(player, player.relation, now);
  const day =
    player.relation === 'none' && player.played_together_at
      ? relativeDay(player.played_together_at, now)
      : null;
  if (day)
    return {
      ...row,
      line:
        form === 'day'
          ? day.charAt(0).toLocaleUpperCase() + day.slice(1)
          : t('friends.played_together', { when: day }),
      tone: 'quiet',
    };
  if (player.relation === 'added')
    return { ...row, line: t('friends.waiting_accept', { name: player.display_name }) };
  if (player.relation === 'friend')
    return { ...row, dot: null, line: t('friends.your_friend'), tone: 'quiet' };
  return row;
}

/**
 * Rows on Add a friend follow the friends lists: a request accepted while the
 * screen is open reads as a friend there too. Lists that do not know a
 * player leave the row as the server last said.
 */
export function followFriendLists(
  players: FriendResult[],
  lists: Pick<FriendLists, 'friends' | 'added_you' | 'requested'>
): FriendResult[] {
  const has = (list: { user_id: string }[] | undefined, id: string) =>
    !!list?.some((p) => p.user_id === id);
  return players.map((player) => {
    const relation = has(lists.friends, player.user_id)
      ? 'friend'
      : has(lists.added_you, player.user_id)
        ? 'added_you'
        : has(lists.requested, player.user_id)
          ? 'added'
          : player.relation;
    return relation === player.relation ? player : { ...player, relation };
  });
}

export interface FriendRowState {
  variant: 'friend' | 'request' | 'sent' | 'fresh';
  dot: 'online' | 'table' | null;
  line: string;
  tone: 'green' | 'gold' | 'quiet';
}

function dated(
  key: 'friends.played' | 'friends.asked' | 'friends.request_sent_when',
  date: string | null | undefined,
  now: Date
) {
  const day = date ? relativeDay(date, now) : null;
  return day ? t(key, { when: day }) : null;
}

function presenceStatus(entry: FriendEntry, now: Date): Omit<FriendRowState, 'variant'> {
  const { presence, join_as } = entry;
  if (presence === 'online')
    return { dot: 'online', line: t('friends.free_to_play'), tone: 'green' };
  if (presence !== 'at_table')
    return {
      dot: null,
      line: dated('friends.played', entry.played_together_at, now) ?? t('friends.not_online'),
      tone: 'quiet',
    };
  if (entry.table_company === 'bots')
    return { dot: 'online', line: t('friends.with_bots'), tone: 'green' };
  if (join_as) {
    const seats = entry.table_open_seats;
    return {
      dot: 'table',
      line: seats
        ? `${t('friends.at_table')} · ${t('social.seats_open', { count: seats, number: formatNumber(seats) })}`
        : t('friends.at_table'),
      tone: 'gold',
    };
  }
  if (entry.table_hand)
    return {
      dot: 'table',
      line: t('friends.at_table_hand', { number: formatNumber(entry.table_hand) }),
      tone: 'gold',
    };
  return entry.table_company === 'people'
    ? { dot: 'table', line: t('friends.with_others'), tone: 'quiet' }
    : { dot: 'table', line: t('friends.at_table'), tone: 'gold' };
}

/** The row's look and its one status line, from the entry alone. Screens use this, not their own rules. */
export function friendRowState(
  entry: FriendEntry,
  relation: FriendRelation = 'friend',
  now: Date = new Date()
): FriendRowState {
  if (relation === 'added_you') {
    const asked = dated('friends.asked', entry.requested_at, now);
    return {
      variant: 'request',
      dot: null,
      line: asked ?? t('friends.wants_to_be_friends'),
      tone: asked ? 'quiet' : 'gold',
    };
  }
  if (relation === 'added') {
    return {
      variant: 'sent',
      dot: null,
      line:
        dated('friends.request_sent_when', entry.requested_at, now) ?? t('friends.request_sent'),
      tone: 'quiet',
    };
  }
  const status = presenceStatus(entry, now);
  if (relation === 'new_friend')
    return { ...status, variant: 'fresh', line: t('friends.friends_now'), tone: 'green' };
  return { ...status, variant: 'friend' };
}
