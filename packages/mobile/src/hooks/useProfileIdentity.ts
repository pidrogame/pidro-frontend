import { useCallback } from 'react';
import { profileApi } from '@/api/profile';
import { authStore } from '@/stores/auth';

export function useProfileIdentity() {
  return useCallback(async () => {
    const before = authStore.getState();
    if (!before.user || !before.accessToken) return undefined;
    const identity = await profileApi.getIdentity();
    const current = authStore.getState();
    if (
      current.user?.id !== before.user.id ||
      current.accessToken !== before.accessToken ||
      identity.user_id !== before.user.id
    )
      return undefined;
    const currentUser = current.user;
    current.setSession({
      accessToken: current.accessToken,
      refreshToken: current.refreshToken ?? undefined,
      user: {
        ...currentUser,
        username: identity.username,
        display_name: identity.display_name,
        // An upload/removal completed while this older profile read was in flight.
        avatar_url:
          currentUser.avatar_url === before.user.avatar_url
            ? identity.avatar_url
            : currentUser.avatar_url,
        bio: identity.bio,
      },
    });
    return identity;
  }, []);
}
