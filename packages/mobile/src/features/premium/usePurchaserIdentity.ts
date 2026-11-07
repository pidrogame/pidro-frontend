import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth';
import { clearPurchaser, identifyPurchaser } from './purchases';

/** RevenueCat knows the player by their user id, guests included, and forgets them on sign-out. */
export function usePurchaserIdentity() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const userId = useAuthStore((state) => state.user?.id);

  useEffect(() => {
    if (!hydrated) return;
    if (userId) void identifyPurchaser(userId);
    else void clearPurchaser();
  }, [hydrated, userId]);
}
