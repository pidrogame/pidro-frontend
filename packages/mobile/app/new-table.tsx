import { useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { CreateRoomRequest } from '@pidro/shared';
import { lobbyApi } from '@/api/lobby';
import { captureAnalytics } from '@/analytics/PostHogAnalytics';
import { AuthSheet } from '@/components/auth/AuthSheet';
import { NewTableScreen } from '@/components/lobby/NewTableScreen';
import { createFailure, roomHasUser } from '@/features/lobby/newTable';
import { useTranslation, type TranslationKey } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { useLobbyStore } from '@/stores/lobby';
import { apiErrorInfo, localizedError } from '@/utils/apiErrors';

export default function NewTableRoute() {
  const { partner } = useLocalSearchParams<{ partner?: string }>();
  const router = useRouter();
  useTranslation();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [failure, setFailure] = useState<{ error?: unknown; key: TranslationKey }>();
  const [accountOpen, setAccountOpen] = useState(false);
  const pending = useRef<CreateRoomRequest | null>(null);
  const create = async (data: CreateRoomRequest, mayRequestAccount = true) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFailure(undefined);
    try {
      let response;
      try {
        response = await lobbyApi.createRoom(data);
      } catch (error) {
        if (apiErrorInfo(error).code !== 'ALREADY_IN_ROOM') throw error;
        // A full waiting table appears in no lobby category, but remains in rooms.
        const current = await Promise.all([lobbyApi.listLobby(), lobbyApi.listRooms()]).catch(
          () => null
        );
        if (!current) {
          setFailure({ key: 'social.quick_unknown' });
          return;
        }
        const [lobby, allRooms] = current;
        const userId = useAuthStore.getState().user?.id;
        useLobbyStore.getState().setLobby(lobby.lobby);
        if (
          lobby.lobby.my_rejoinable.length ||
          [...lobby.rooms, ...allRooms.rooms].some(
            (room) => room.status !== 'finished' && roomHasUser(room, userId)
          )
        ) {
          setFailure({ key: 'social.already_table' });
          return;
        }
        await lobbyApi.leaveRoom('current').catch(() => undefined);
        response = await lobbyApi.createRoom(data);
      }
      if (!response?.code) throw new Error('No room code returned');
      captureAnalytics('room_created', {
        creation_source: 'lobby',
        has_bots: Object.values(data.seats ?? {}).some(
          (seat) => seat === 'ai' || (typeof seat === 'object' && seat.type === 'ai')
        ),
      });
      useLobbyStore.getState().upsertLobbyRoom(response.room, 'my_rejoinable');
      router.replace(`/game/${response.code}`);
    } catch (error) {
      if (apiErrorInfo(error).code === 'ACCOUNT_REQUIRED' && mayRequestAccount) {
        pending.current = data;
        setAccountOpen(true);
      } else setFailure(createFailure(error, data));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <NewTableScreen
        partner={partner}
        onSubmit={(request) => void create(request)}
        onLeave={() => (router.canGoBack() ? router.back() : router.replace('/lobby'))}
        busy={busy}
        error={failure ? localizedError(failure.error, failure.key) : undefined}
      />
      <AuthSheet
        isOpen={accountOpen}
        reason="multiplayer"
        onClose={() => {
          pending.current = null;
          setAccountOpen(false);
        }}
        onSaved={() => {
          const request = pending.current;
          pending.current = null;
          setAccountOpen(false);
          if (request) void create(request, false);
        }}
        onClaimClassic={() => {
          pending.current = null;
          setAccountOpen(false);
          router.push('/(auth)/claim-classic');
        }}
      />
    </>
  );
}
