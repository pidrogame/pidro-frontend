import type { ApiClient } from './client';

export type PremiumSource = 'store' | 'promotional' | 'classic_honored';

/** The Premium fields of `/me`. The server owns them (PID-125); the app only renders them. */
export interface PremiumFields {
  premium: boolean;
  premium_until: string | null;
  premium_source: PremiumSource | null;
}

export function createPremiumApi(api: ApiClient) {
  return {
    /** Asks the server to sync this player with RevenueCat; answers the fields afterwards. */
    refresh: async (): Promise<PremiumFields> => {
      const response = await api.post<{ data: PremiumFields }>('/api/v1/me/entitlements/refresh');
      return response.data.data;
    },
  };
}

export type PremiumApi = ReturnType<typeof createPremiumApi>;
