import { useState } from 'react';
import { useRouter } from 'expo-router';
import { lobbyApi } from '@/api/lobby';
import { useAdOffer, type AdSheetPhase } from '@/features/ads/useAdOffer';
import { createSoloRoom } from '@/features/game/solo';
import { gameRoute } from '@/navigation/gameRoute';
import { useLobbyStore } from '@/stores/lobby';
import { apiErrorInfo, localizedError } from '@/utils/apiErrors';
import { useTranslation, type TranslationKey } from '@/i18n';

export const TABLE_UNKNOWN_ERROR = 'social.quick_unknown' as const;

/** You and three bots, started the same way from Home and from an empty Tables screen. */
export function useQuickGame(
  initialError: TranslationKey | null = null,
  adFixture: AdSheetPhase | null = null
) {
  useTranslation();
  const ad = useAdOffer('solo', adFixture);
  const router = useRouter();
  const upsertLobbyRoom = useLobbyStore((state) => state.upsertLobbyRoom);
  const [loading, setLoading] = useState(false);
  const [failure, setError] = useState<{ cause?: unknown; fallback: TranslationKey } | null>(
    initialError ? { fallback: initialError } : null
  );

  const createSinglePlayerRoom = async () => {
    const response = await createSoloRoom();
    if (response.room) upsertLobbyRoom(response.room, 'my_rejoinable');
    router.replace(gameRoute(response.code, 'single-player'));
  };

  const deal = async () => {
    setLoading(true);
    setError(null);

    try {
      await createSinglePlayerRoom();
    } catch (err: unknown) {
      const { code } = apiErrorInfo(err);
      if (code === 'AD_REQUIRED' && ad.required(deal)) return;
      if (code === 'ALREADY_IN_ROOM') {
        const lobbyResponse = await lobbyApi.listLobby().catch(() => null);
        if (!lobbyResponse) {
          // Without the lobby we cannot tell a solo table from a live multiplayer one.
          setError({ fallback: TABLE_UNKNOWN_ERROR });
        } else if (lobbyResponse.lobby.my_rejoinable.length) {
          setError({ fallback: 'social.quick_multiplayer' });
          router.push('/lobby');
        } else {
          try {
            // No table left to leave is the state we wanted.
            await lobbyApi.leaveRoom('current').catch(() => undefined);
            await createSinglePlayerRoom();
          } catch (retryError) {
            if (apiErrorInfo(retryError).code === 'AD_REQUIRED' && ad.required(deal)) return;
            setError({ cause: retryError, fallback: 'social.quick_clear' });
          }
        }
      } else {
        setError({ cause: err, fallback: 'social.quick_error' });
      }
    } finally {
      setLoading(false);
    }
  };

  return {
    start: () => ad.play(deal),
    loading: loading || ad.busy,
    adSheet: ad.sheet,
    error: failure ? localizedError(failure.cause, failure.fallback) : null,
  };
}
