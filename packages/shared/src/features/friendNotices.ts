import type { ClassicPremium } from '../api/classic';
import type { FriendLists, FriendPlayer } from '../api/friends';
import type { SeatInvitation } from '../types/lobby';

export type FriendNotice =
  /** After a claim, what became of Classic Premium (PID-391). */
  | { kind: 'classic_premium'; premium: ClassicPremium }
  | { kind: 'request'; player: FriendPlayer; played_together_at: string | null }
  | { kind: 'accepted'; player: FriendPlayer; source: 'accept' }
  /** Signing up through someone's own link sends them a request; they still answer it. */
  | { kind: 'sent'; player: FriendPlayer }
  | { kind: 'seat'; invitation: SeatInvitation }
  | { kind: 'too_late'; invitation: SeatInvitation };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFriendPlayer(value: unknown): value is FriendPlayer {
  return (
    object(value) &&
    typeof value.user_id === 'string' &&
    value.user_id.length > 0 &&
    typeof value.display_name === 'string' &&
    (value.avatar_url === null || typeof value.avatar_url === 'string') &&
    typeof value.presence === 'string' &&
    ['online', 'at_table', 'offline'].includes(value.presence)
  );
}

export function isFriendRequest(
  value: unknown
): value is Omit<Extract<FriendNotice, { kind: 'request' }>, 'kind'> {
  return (
    object(value) &&
    isFriendPlayer(value.player) &&
    (value.played_together_at === null ||
      (typeof value.played_together_at === 'string' &&
        Number.isFinite(Date.parse(value.played_together_at))))
  );
}

export function isFriendAccepted(
  value: unknown
): value is Omit<Extract<FriendNotice, { kind: 'accepted' }>, 'kind'> {
  return object(value) && isFriendPlayer(value.player) && value.source === 'accept';
}

export function isSeatInvitationGone(
  value: unknown
): value is Pick<SeatInvitation, 'code' | 'position'> & { reason?: string } {
  return (
    object(value) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    typeof value.code === 'string' &&
    value.code.length > 0 &&
    typeof value.position === 'string' &&
    ['north', 'east', 'south', 'west'].includes(value.position)
  );
}

export function isSeatInvitation(value: unknown): value is SeatInvitation {
  return (
    object(value) &&
    typeof value.host_id === 'string' &&
    value.host_id.length > 0 &&
    (value.host === undefined ||
      (object(value.host) &&
        typeof value.host.user_id === 'string' &&
        typeof value.host.display_name === 'string' &&
        (value.host.avatar_url === null || typeof value.host.avatar_url === 'string'))) &&
    (value.rule_set === undefined ||
      value.rule_set === 'finnish' ||
      value.rule_set === 'louisiana') &&
    (value.held_since === undefined || typeof value.held_since === 'string') &&
    isSeatInvitationGone(value)
  );
}

/**
 * A seat that went because the game started, the host let it go or the room
 * closed was missed, so it is said. `declined` is the invitee's own answer and
 * a missing or unknown reason is an older server: both go quietly.
 */
export function seatGoneIsLate(reason: unknown): boolean {
  return reason === 'started' || reason === 'released' || reason === 'closed';
}

export function friendNoticeId(notice: FriendNotice): string {
  if (notice.kind === 'classic_premium') return notice.kind;
  return notice.kind === 'seat' || notice.kind === 'too_late'
    ? `${notice.kind}:${notice.invitation.code}:${notice.invitation.position}:${notice.invitation.held_since ?? ''}`
    : `${notice.kind}:${notice.player.user_id}`;
}

export function enqueueFriendNotice(queue: FriendNotice[], seen: string[], notice: FriendNotice) {
  const id = friendNoticeId(notice);
  if (seen.includes(id)) return { notices: queue, seenNotices: seen };
  return { notices: [...queue, notice], seenNotices: [...seen, id] };
}

/** The seat notice becomes "too late" where it stood, once per invitation. */
export function lateSeatNotice(queue: FriendNotice[], seen: string[], invitation: SeatInvitation) {
  const late: FriendNotice = { kind: 'too_late', invitation };
  const id = friendNoticeId(late);
  const index = queue.findIndex((notice) => sameSeat(notice, invitation));
  const notices = queue.filter((notice) => !sameSeat(notice, invitation));
  if (seen.includes(id)) return { notices, seenNotices: seen };
  notices.splice(index < 0 ? notices.length : index, 0, late);
  return { notices, seenNotices: [...seen, id] };
}

function sameSeat(notice: FriendNotice, seat: Pick<SeatInvitation, 'code' | 'position'>) {
  return (
    notice.kind === 'seat' &&
    notice.invitation.code === seat.code &&
    notice.invitation.position === seat.position
  );
}

/** What is still waiting; a seat reads the latest invitation, which the server re-sends when `join_as` changes. */
export function liveFriendNotices(
  queue: FriendNotice[],
  lists: FriendLists,
  seats: SeatInvitation[]
): FriendNotice[] {
  return queue.flatMap((notice): FriendNotice[] => {
    if (notice.kind === 'request')
      return lists.added_you.some((p) => p.user_id === notice.player.user_id) ? [notice] : [];
    if (notice.kind === 'seat') {
      const invitation = seats.find(
        (seat) => friendNoticeId({ kind: 'seat', invitation: seat }) === friendNoticeId(notice)
      );
      return invitation ? [{ ...notice, invitation }] : [];
    }
    return [notice];
  });
}

/** Finish the visible notice before taking the next, most urgent, one. */
export function nextFriendNotice(
  queue: FriendNotice[],
  currentId?: string
): FriendNotice | undefined {
  return (
    queue.find((notice) => friendNoticeId(notice) === currentId) ??
    queue.find((notice) => notice.kind === 'too_late') ??
    queue.find((notice) => notice.kind === 'seat') ??
    queue.find((notice) => notice.kind === 'request') ??
    queue[0]
  );
}
