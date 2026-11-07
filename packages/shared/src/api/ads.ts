import type { ApiClient } from './client';

/** The server's answer to whether the next solo game needs a short ad (PID-123). */
export interface AdsState {
  eligible: boolean;
  next_game_needs_ad: boolean;
  games_until_ad: number;
  free_games_left: number;
}

/** What became of an ad the server asked for. `watched` and `unavailable` each earn the next solo game. */
export function createAdsApi(api: ApiClient) {
  return {
    watched: async (): Promise<void> => {
      await api.post('/api/v1/me/ads/watched');
    },
    unavailable: async (): Promise<void> => {
      await api.post('/api/v1/me/ads/unavailable');
    },
    dismissed: async (): Promise<void> => {
      await api.post('/api/v1/me/ads/dismissed');
    },
  };
}

export type AdsApi = ReturnType<typeof createAdsApi>;
