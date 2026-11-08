import type { ApiClient } from './client';

/** The device's Expo push token, so the server can reach this install. */
export interface PushTokenRequest {
  token: string;
  platform: 'ios' | 'android';
  install_id: string;
  app_version: string;
  app_build?: string;
}

export function createPushApi(api: ApiClient) {
  return {
    register: async (request: PushTokenRequest): Promise<void> => {
      await api.post('/api/v1/me/push-tokens', request);
    },

    // Expo tokens look like ExponentPushToken[…]; the brackets must not reach the path raw.
    // Sent on the way out (sign-out, a deleted account): a 401 here never clears a session.
    unregister: async (token: string): Promise<void> => {
      await api.delete(`/api/v1/me/push-tokens/${encodeURIComponent(token)}`, {
        preserveSessionOnUnauthorized: true,
      });
    },
  };
}

export type PushApi = ReturnType<typeof createPushApi>;
