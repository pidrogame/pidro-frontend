import { createAuthStore, type AuthState } from '@pidro/shared';
import { secureStorage } from '@/utils/storage';
import { STORAGE_KEYS } from '@/constants/config';
import { keepPlayer } from '@/features/auth/knownPlayer';

export type { User, AuthState, AuthStatus } from '@pidro/shared';

export const useAuthStore = createAuthStore({
  storage: secureStorage,
  storageKey: STORAGE_KEYS.auth,
});

export const authStore = useAuthStore;

// The phone keeps who is signed in for "Welcome back" (PID-456): at start and whenever the
// player changes. A user without a token is a session hydration is about to refuse.
const keepSignedInPlayer = ({ accessToken, user }: AuthState) => {
  if (accessToken) keepPlayer(user);
};
keepSignedInPlayer(useAuthStore.getState());
useAuthStore.subscribe((state, previous) => {
  if (state.user !== previous.user) keepSignedInPlayer(state);
});
