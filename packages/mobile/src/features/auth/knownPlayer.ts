import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@/api/auth';
import { STORAGE_KEYS } from '@/constants/config';
import { firstScreen, keptPlayer, type FirstScreen, type SignInMethod } from './firstScreen';

/** The one record behind "Welcome back", outside auth-storage so sign-out leaves it. */
export async function readFirstScreen(): Promise<FirstScreen> {
  return firstScreen(await AsyncStorage.getItem(STORAGE_KEYS.knownPlayer).catch(() => null));
}

/** After every sign-in; signing in as someone else replaces it. */
export async function rememberPlayer(user: User, method: SignInMethod): Promise<void> {
  const kept = keptPlayer(user, method);
  if (kept) await AsyncStorage.setItem(STORAGE_KEYS.knownPlayer, kept).catch(() => {});
}

/** "Not you?" and Delete account. */
export async function forgetPlayer(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.knownPlayer).catch(() => {});
}
