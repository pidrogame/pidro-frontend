import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth';
import { refreshForIdentity } from './premium';
import { clearPurchaser, identifyPurchaser } from './purchases';

/**
 * RevenueCat knows the player by their user id, guests included, and forgets them on sign-out.
 * Once it knows them, the server looks again: the purchases on this phone may now be theirs.
 */
export function usePurchaserIdentity() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const userId = useAuthStore((state) => state.user?.id);

  useEffect(() => {
    if (!hydrated) return;
    if (userId) void identifyPurchaser(userId).then(() => refreshForIdentity(userId));
    else {
      void clearPurchaser();
      void refreshForIdentity(null);
    }
  }, [hydrated, userId]);
}
