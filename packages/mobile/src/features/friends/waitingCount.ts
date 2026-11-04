import type { FriendLists, FriendPlayer, SeatInvitation } from '@pidro/shared';

export function waitingCount(
  friends: Pick<FriendLists, 'waiting_for_you' | 'requests_waiting' | 'added_you'>,
  invitations: readonly SeatInvitation[]
): number {
  return (
    friends.waiting_for_you ??
    (friends.requests_waiting ?? friends.added_you.length) + invitations.length
  );
}

/** Friends in the app or at a table. */
export function onlineCount(friends: readonly Pick<FriendPlayer, 'presence'>[]): number {
  return friends.filter(({ presence }) => presence === 'online' || presence === 'at_table').length;
}

/** The Friends tab's count (PID-347): an answer waiting wins in red, else who is online, else none. */
export function friendsTabCount(
  waiting: number,
  online: number
): { tone: 'alert' | 'online'; count: number } | null {
  if (waiting > 0) return { tone: 'alert', count: waiting };
  if (online > 0) return { tone: 'online', count: online };
  return null;
}
