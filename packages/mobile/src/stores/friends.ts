import {
  isFriendPlayer,
  useFriendsStore,
  type BlockedPlayers,
  type ClassicPremium,
  type FriendLists,
  type FriendPlayer,
  type SeatInvitation,
} from '@pidro/shared';
import { friendsApi } from '@/api/friends';
import { lobbyApi } from '@/api/lobby';
import { classicPremiumLine } from '@/features/premium/classicPremium';
import { apiErrorInfo } from '@/utils/apiErrors';
import { authStore } from './auth';

export { useFriendsStore };

let revision = 0;
let requests: Promise<unknown> = Promise.resolve();
let focusedAt = 0;
authStore.subscribe((state, previous) => {
  if (state.accessToken !== previous.accessToken) {
    revision++;
    focusedAt = 0;
    requests = Promise.resolve();
    useFriendsStore.getState().reset();
  }
});

function updateLists<T extends FriendLists | BlockedPlayers>(request: () => Promise<T>) {
  const current = revision;
  // A mutation's full answer lands before its friends_changed refetch.
  const result = requests.then(async () => {
    if (current !== revision) return;
    const store = useFriendsStore.getState();
    store.setError(null);
    store.setLoading(true);
    try {
      const lists = await request();
      if (current === revision) store.setLists(lists);
      return lists;
    } catch (error) {
      if (current === revision) store.setError(error ?? true);
      throw error;
    }
  });
  requests = result.catch(() => undefined);
  return result;
}

export const refreshFriends = () => updateLists(friendsApi.list);
export const addFriend = (id: string) => updateLists(() => friendsApi.add(id));
export const removeFriend = (id: string) => updateLists(() => friendsApi.remove(id));
export const ignoreFriend = (id: string) => updateLists(() => friendsApi.ignore(id));
export const unignoreFriend = (id: string) => updateLists(() => friendsApi.unignore(id));

export const refreshBlockedPlayers = () => updateLists(friendsApi.blocks);
export const unblockPlayer = (id: string) => updateLists(() => friendsApi.unblock(id));
export async function blockPlayer(id: string) {
  await updateLists(() => friendsApi.block(id));
  void refreshFriends().catch(() => undefined);
}

/**
 * Not now: the invitation goes once the server has the answer; a seat already gone is the
 * same answer. Anything else throws, and the invitation stays where it was.
 */
export async function declineSeatInvitation(invitation: SeatInvitation): Promise<void> {
  const token = authStore.getState().accessToken;
  try {
    await lobbyApi.declineSeatInvitation(invitation.code, invitation.position);
  } catch (error) {
    if (apiErrorInfo(error).code?.toUpperCase() !== 'INVITATION_GONE') throw error;
  } finally {
    if (token === authStore.getState().accessToken) void refreshFriends().catch(() => undefined);
  }
  if (token === authStore.getState().accessToken)
    authStore.getState().removeSeatInvitation(invitation);
}

/**
 * A sign-up through someone's link sends them a request: "Request sent. You'll be friends
 * once Bertil accepts." A Classic claim can instead accept Bertil's own request, so the
 * friends list decides: only a request still waiting is told.
 */
export function queueLinkedFriend(friend: FriendPlayer | undefined) {
  if (!isFriendPlayer(friend)) return;
  void refreshFriends()
    .then((lists) => {
      if (lists?.requested?.some((p) => p.user_id === friend.user_id))
        useFriendsStore.getState().queueNotice({ kind: 'sent', player: friend });
    })
    .catch(() => undefined);
}

/** A claim's word on Classic Premium; queued before the linked friend, so it shows first. */
export function queueClassicPremium(premium: ClassicPremium | undefined) {
  if (premium && classicPremiumLine(premium))
    useFriendsStore.getState().queueNotice({ kind: 'classic_premium', premium });
}

/** Home asks again as it comes into focus, at most every 30 s; the lobby channel's join covers the foreground. */
export function refreshFriendsOnFocus() {
  if (Date.now() - focusedAt < 30_000) return;
  focusedAt = Date.now();
  void refreshFriends().catch(() => undefined);
}
