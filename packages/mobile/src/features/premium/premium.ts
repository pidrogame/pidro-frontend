/**
 * Premium as the server says it (PID-124). When the store may know something new (an
 * identify, the first sync, a restore) the app asks the server to look again and keeps
 * its answer on the session user. Nothing here decides who is Premium.
 */
import type { PremiumFields } from '@pidro/shared';
import { premiumApi } from '@/api/premium';
import { authStore } from '@/stores/auth';
import { purchasesAvailable, restorePurchases } from './purchases';

export function premiumStatus(user: Partial<PremiumFields> | null | undefined) {
  return {
    premium: user?.premium === true,
    until: user?.premium_until ? new Date(user.premium_until) : null,
    source: user?.premium_source ?? null,
  };
}

let latest = 0;

/** Never throws: a server that cannot look leaves the user as it last said. */
export async function refreshPremium(): Promise<PremiumFields | null> {
  const userId = authStore.getState().user?.id;
  if (!userId) return null;
  const asked = ++latest;
  try {
    const fields = await premiumApi.refresh();
    const user = authStore.getState().user;
    // Only the newest question's answer, and only for the player who asked it.
    if (asked === latest && user?.id === userId)
      authStore.setState({ user: { ...user, ...fields } });
    return fields;
  } catch (error) {
    const status = (error as { response?: { status?: number } } | null)?.response?.status;
    // 404: a server before PID-125. 503: RevenueCat is not configured or not reachable.
    if (status === 404 || status === 503) console.log('[Premium] Refresh unavailable', status);
    else console.warn('[Premium] Could not refresh', error);
    return null;
  }
}

let refreshedFor: string | null = null;

/** After identifyPurchaser, and null on sign-out: once per identity, so a sign-in asks once. */
export async function refreshForIdentity(userId: string | null): Promise<void> {
  if (userId === refreshedFor || !purchasesAvailable()) return;
  if (userId && authStore.getState().user?.id !== userId) return;
  refreshedFor = userId;
  if (userId) await refreshPremium();
}

export type RestoreOutcome = 'restored' | 'notFound' | 'failed';

/** Settings → Restore purchases: the store, then the server, then one answer for the toast. */
export async function restorePremium(): Promise<RestoreOutcome> {
  const restored = await restorePurchases();
  if (!restored.ok) {
    console.warn('[Premium] Restore did not finish', restored.reason);
    return 'failed';
  }
  // The server's answer decides; when it could not look, the restore did not finish.
  const fields = await refreshPremium();
  if (!fields) return 'failed';
  return fields.premium ? 'restored' : 'notFound';
}

const fixtureUsers: Record<string, PremiumFields> = {
  none: { premium: false, premium_until: null, premium_source: null },
  until: { premium: true, premium_until: '2027-03-12T12:00:00Z', premium_source: 'store' },
  lifetime: { premium: true, premium_until: null, premium_source: 'promotional' },
  restoring: { premium: false, premium_until: null, premium_source: null },
};

/** `?fixture=premium-<state>`: the phone's panel, also on web, with a made-up answer. */
export function premiumFixture(value?: string) {
  const fields = value?.startsWith('premium-') && fixtureUsers[value.slice('premium-'.length)];
  if (!__DEV__ || !fields) return undefined;
  return { fields, restoring: value === 'premium-restoring' };
}
