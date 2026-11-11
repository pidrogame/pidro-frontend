import { expect, mock, test } from 'bun:test';
import { friendNoticeId, nextFriendNotice, useFriendsStore } from '@pidro/shared';

let lists = { friends: [], added_you: [] };
let decline;
const auth = {
  accessToken: 'token',
  seatInvitations: [],
  removeSeatInvitation: ({ code, position }) => {
    auth.seatInvitations = auth.seatInvitations.filter(
      (seat) => seat.code !== code || seat.position !== position
    );
  },
};
mock.module('../../src/api/friends.ts', () => ({ friendsApi: { list: async () => lists } }));
mock.module('../../src/api/lobby.ts', () => ({
  lobbyApi: { declineSeatInvitation: () => decline() },
}));
mock.module('../../src/stores/auth.ts', () => ({
  authStore: { subscribe: () => () => {}, getState: () => auth },
}));
const { declineSeatInvitation, queueClassicPremium, queueLinkedFriend } =
  await import('../../src/stores/friends.ts');

const bertil = { user_id: 'bertil', display_name: 'Bertil', avatar_url: null, presence: 'online' };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a sign-up through a link says Request sent only while the request waits', async () => {
  lists = { friends: [], added_you: [], requested: [bertil] };
  queueLinkedFriend(bertil);
  await settle();
  expect(useFriendsStore.getState().notices).toEqual([{ kind: 'sent', player: bertil }]);

  // A Classic claim accepted Bertil's own request: they are friends, nothing was sent.
  useFriendsStore.getState().reset();
  lists = { friends: [bertil], added_you: [], requested: [] };
  queueLinkedFriend(bertil);
  await settle();
  expect(useFriendsStore.getState().notices).toEqual([]);
});

test('a claim says what happened to Classic Premium before the linked friend, and drops neither', async () => {
  useFriendsStore.getState().reset();
  lists = { friends: [], added_you: [], requested: [bertil] };
  const carried = { state: 'carried', until: null };
  queueClassicPremium(carried);
  queueLinkedFriend(bertil);
  await settle();
  const { notices } = useFriendsStore.getState();
  expect(notices).toEqual([
    { kind: 'classic_premium', premium: carried },
    { kind: 'sent', player: bertil },
  ]);
  expect(nextFriendNotice(notices)).toEqual(notices[0]);
  // Once the Premium line goes, the friend's notice is next.
  useFriendsStore.getState().dismissNotice(friendNoticeId(notices[0]));
  expect(nextFriendNotice(useFriendsStore.getState().notices)).toEqual(notices[1]);

  // Pending and an older server's answer queue nothing.
  useFriendsStore.getState().reset();
  queueClassicPremium({ state: 'pending', until: null });
  queueClassicPremium(undefined);
  expect(useFriendsStore.getState().notices).toEqual([]);
});

test('Not now that fails throws and leaves the invitation where it was', async () => {
  const astrid = { code: 'ASTR', position: 'north', host_id: 'astrid' };
  const kalle = { code: 'KALL', position: 'east', host_id: 'kalle' };

  auth.seatInvitations = [astrid, kalle];
  decline = async () => {
    throw new Error('Network Error');
  };
  await expect(declineSeatInvitation(astrid)).rejects.toThrow('Network Error');
  expect(auth.seatInvitations).toEqual([astrid, kalle]);

  // A seat already gone is the same answer as a declined one.
  decline = async () => {
    throw { response: { data: { code: 'INVITATION_GONE' } } };
  };
  await declineSeatInvitation(astrid);
  expect(auth.seatInvitations).toEqual([kalle]);

  decline = async () => undefined;
  await declineSeatInvitation(kalle);
  expect(auth.seatInvitations).toEqual([]);
});
