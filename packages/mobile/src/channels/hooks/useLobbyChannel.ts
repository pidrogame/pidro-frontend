import { useEffect, useRef } from 'react';
import { Channel, Presence } from 'phoenix';
import { batchedUpdates as unstable_batchedUpdates } from '@/utils/batchedUpdates';
import { phoenixSocket } from '../socket';
import { initRealtime } from '@/bootstrap/realtime';
import { useLobbyStore } from '@/stores/lobby';
import { refreshFriends, useFriendsStore } from '@/stores/friends';
import { authStore } from '@/stores/auth';
import { getSeatInvitations } from '@/api/auth';
import {
  isFriendRequest,
  isFriendAccepted,
  isSeatInvitation,
  isSeatInvitationGone,
  seatGoneIsLate,
} from '@pidro/shared';
import {
  flattenLobbyCategories,
  hasLobbyCategories,
  normalizeLobbyCategories,
  normalizeRoom,
  normalizeRooms,
} from '@/utils/rooms';

// Singleton channel reference to prevent multiple connections
let globalChannel: Channel | null = null;
let referenceCount = 0;

export const useLobbyChannel = (onRealtimeUpdate?: () => void) => {
  // Get store functions directly from the store to avoid dependency issues
  // These are stable references that won't change between renders
  const setRooms = useLobbyStore((s) => s.setRooms);
  const setLobby = useLobbyStore((s) => s.setLobby);
  const addRoom = useLobbyStore((s) => s.addRoom);
  const updateRoom = useLobbyStore((s) => s.updateRoom);
  const upsertLobbyRoom = useLobbyStore((s) => s.upsertLobbyRoom);
  const removeRoom = useLobbyStore((s) => s.removeRoom);
  const setStats = useLobbyStore((s) => s.setStats);
  const onRealtimeUpdateRef = useRef(onRealtimeUpdate);

  useEffect(() => {
    onRealtimeUpdateRef.current = onRealtimeUpdate;
  }, [onRealtimeUpdate]);

  useEffect(() => {
    initRealtime();

    referenceCount++;

    const connect = () => {
      if (globalChannel) return;

      const channel = phoenixSocket.channel('lobby', phoenixSocket.connectionParams());
      let presences = {};
      let invitationEvents: (() => void)[] | null = null;

      const refresh = () => {
        if (!authStore.getState().user?.guest) void refreshFriends().catch(() => undefined);
      };

      const refreshInvitations = async () => {
        const token = authStore.getState().accessToken;
        const events: (() => void)[] = [];
        invitationEvents = events;
        try {
          const invitations = await getSeatInvitations();
          if (
            globalChannel !== channel ||
            token !== authStore.getState().accessToken ||
            invitationEvents !== events
          )
            return;
          authStore.getState().setSeatInvitations(invitations);
          // Events delivered during /me are newer than its snapshot.
          events.forEach((apply) => apply());
          if (!authStore.getState().user?.guest) {
            authStore.getState().seatInvitations.forEach((invitation) => {
              if (isSeatInvitation(invitation))
                useFriendsStore.getState().queueNotice({ kind: 'seat', invitation });
            });
          }
        } catch {
          setTimeout(() => {
            if (globalChannel === channel && token === authStore.getState().accessToken)
              void refreshInvitations();
          }, 5000);
        } finally {
          if (invitationEvents === events) invitationEvents = null;
        }
      };

      channel.on('seat_invitation', (invitation: unknown) => {
        if (!isSeatInvitation(invitation)) {
          console.warn('[LobbyChannel] Invalid seat_invitation payload');
          return;
        }
        const apply = () => authStore.getState().receiveSeatInvitation(invitation);
        invitationEvents?.push(apply);
        apply();
        if (!authStore.getState().user?.guest)
          useFriendsStore.getState().queueNotice({ kind: 'seat', invitation });
        refresh();
      });
      channel.on('seat_invitation_gone', (seat: unknown) => {
        if (!isSeatInvitationGone(seat)) {
          console.warn('[LobbyChannel] Invalid seat_invitation_gone payload');
          return;
        }
        const apply = () => {
          const late = seatGoneIsLate(seat.reason)
            ? authStore
                .getState()
                .seatInvitations.find(
                  (shown) => shown.code === seat.code && shown.position === seat.position
                )
            : undefined;
          authStore.getState().removeSeatInvitation(seat);
          if (late) {
            useFriendsStore.getState().lateSeat(late);
            return;
          }
          useFriendsStore.setState((state) => ({
            notices: state.notices.filter(
              (notice) =>
                notice.kind !== 'seat' ||
                notice.invitation.code !== seat.code ||
                notice.invitation.position !== seat.position
            ),
          }));
        };
        invitationEvents?.push(apply);
        apply();
        refresh();
      });

      channel.on('friend_request', (payload: unknown) => {
        if (!isFriendRequest(payload)) {
          console.warn('[LobbyChannel] Invalid friend_request payload');
          return;
        }
        if (authStore.getState().user?.guest) return;
        const token = authStore.getState().accessToken;
        // Confirm it is still waiting before prompting; a missed prompt never owns the badge.
        void refreshFriends()
          .then(() => {
            const store = useFriendsStore.getState();
            if (
              token === authStore.getState().accessToken &&
              store.added_you.some((p) => p.user_id === payload.player.user_id)
            )
              store.queueNotice({ ...payload, kind: 'request' });
          })
          .catch(() => undefined);
      });

      channel.on('friend_accepted', (payload: unknown) => {
        if (!isFriendAccepted(payload)) {
          console.warn('[LobbyChannel] Invalid friend_accepted payload');
          return;
        }
        if (authStore.getState().user?.guest) return;
        useFriendsStore.getState().queueNotice({ ...payload, kind: 'accepted' });
        refresh();
      });

      channel.on('friends_changed', refresh);

      channel
        .join()
        .receive('ok', (response: any) => {
          if (!authStore.getState().user?.guest) void refreshFriends().catch(() => undefined);
          void refreshInvitations();
          onRealtimeUpdateRef.current?.();
          // Batch updates to avoid navigation context issues
          unstable_batchedUpdates(() => {
            useLobbyStore.setState({
              minimumNativeVersions: response?.minimum_native_versions ?? {},
            });
            const rawLobby = response?.lobby ?? response?.data?.lobby;
            if (hasLobbyCategories(rawLobby)) {
              const lobby = normalizeLobbyCategories(rawLobby);
              const rooms = flattenLobbyCategories(lobby);
              setLobby(lobby);
              setStats({ active_games: rooms.length });
              return;
            }

            const rooms = normalizeRooms(response?.rooms ?? response?.data?.rooms);
            setRooms(rooms);
            setStats({ active_games: rooms.length });
          });
        })
        .receive('error', (resp) => {
          console.error('[LobbyChannel] Unable to join', resp);
        });

      channel.on('lobby_update', (payload: any) => {
        onRealtimeUpdateRef.current?.();
        unstable_batchedUpdates(() => {
          const rawLobby = payload?.lobby ?? payload?.data?.lobby;
          if (hasLobbyCategories(rawLobby)) {
            const lobby = normalizeLobbyCategories(rawLobby);
            const rooms = flattenLobbyCategories(lobby);
            setLobby(lobby);
            setStats({ active_games: rooms.length });
            return;
          }

          const rooms = normalizeRooms(payload?.rooms ?? payload?.data?.rooms);
          setRooms(rooms);
          setStats({ active_games: rooms.length });
        });
      });

      channel.on('room_created', (payload: any) => {
        const room = payload?.room || payload?.data?.room;
        if (room) {
          onRealtimeUpdateRef.current?.();
          unstable_batchedUpdates(() => {
            const category = 'category' in payload ? payload.category : payload?.data?.category;
            if (category !== undefined) {
              upsertLobbyRoom(normalizeRoom(room), category);
            } else {
              addRoom(normalizeRoom(room));
            }
          });
        } else {
          console.warn('[LobbyChannel] Invalid room_created payload:', payload);
        }
      });

      channel.on('room_updated', (payload: any) => {
        const room = payload?.room || payload?.data?.room;
        if (room) {
          onRealtimeUpdateRef.current?.();
          unstable_batchedUpdates(() => {
            const category = 'category' in payload ? payload.category : payload?.data?.category;
            if (category !== undefined) {
              upsertLobbyRoom(normalizeRoom(room), category);
            } else {
              updateRoom(normalizeRoom(room));
            }
          });
        } else {
          console.warn('[LobbyChannel] Invalid room_updated payload:', payload);
        }
      });

      channel.on('room_closed', (payload: any) => {
        const code =
          payload?.code || payload?.room?.code || payload?.data?.code || payload?.room_code;
        const id = payload?.id || payload?.room?.id || payload?.data?.id;

        if (code || id) {
          onRealtimeUpdateRef.current?.();
          removeRoom(code || id);
        }
      });

      channel.on('presence_state', (state) => {
        presences = Presence.syncState(presences, state);
        const onlineCount = Object.keys(presences).length;
        setStats({ online_players: onlineCount });
      });

      channel.on('presence_diff', (diff) => {
        presences = Presence.syncDiff(presences, diff);
        const onlineCount = Object.keys(presences).length;
        setStats({ online_players: onlineCount });
      });

      globalChannel = channel;
    };

    connect();

    return () => {
      referenceCount--;
      if (referenceCount === 0 && globalChannel) {
        globalChannel.leave();
        globalChannel = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};
