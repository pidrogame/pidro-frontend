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
    // False when an upload, removal or face landed while this older read was in flight.
    const fresh = currentUser.avatar_url === before.user.avatar_url;
    current.setSession({
      accessToken: current.accessToken,
      refreshToken: current.refreshToken ?? undefined,
      user: {
        ...currentUser,
        username: identity.username,
        display_name: identity.display_name,
        avatar_url: fresh ? identity.avatar_url : currentUser.avatar_url,
        avatar_face:
          fresh && identity.avatar_face !== undefined
            ? identity.avatar_face
            : currentUser.avatar_face,
        has_photo:
          fresh && identity.has_photo !== undefined ? identity.has_photo : currentUser.has_photo,
        bio: identity.bio,
      },
    });
    return identity;
  }, []);
}
