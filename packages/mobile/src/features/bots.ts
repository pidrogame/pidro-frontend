import { useEffect } from 'react';
import {
  normalizeBotProfiles,
  resolveBotProfile,
  useBotCatalogueStore,
  type BotProfile,
} from '@pidro/shared';
import { api } from '@/api/client';

let pending: Promise<void> | null = null;
let fetchedAt = 0;
/** Shared in-flight request; old servers may omit the public endpoint. */
export function loadCatalogue() {
  if (pending || Date.now() - fetchedAt < 60_000) return;
  fetchedAt = Date.now();
  pending = api
    .get<{ data: unknown }>('/api/v1/bots', { preserveSessionOnUnauthorized: true })
    .then(({ data }) =>
      useBotCatalogueStore.getState().setProfiles(normalizeBotProfiles(data.data))
    )
    .catch(() => {
      /* Snapshot/built-in/neutral fallback remains usable offline. */
    })
    .finally(() => {
      pending = null;
    });
}

export function useBotProfile(id?: string | null, profile?: BotProfile | null) {
  const profiles = useBotCatalogueStore((state) => state.profiles);
  useEffect(() => {
    if (id) loadCatalogue();
  }, [id]);
  return resolveBotProfile(id, profile, profiles);
}
