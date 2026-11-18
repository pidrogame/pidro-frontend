import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@/api/auth';
import { STORAGE_KEYS } from '@/constants/config';
import { firstScreen, keptPlayer, type FirstScreen, type SignInMethod } from './firstScreen';

/** The one record behind "Welcome back", outside auth-storage so sign-out leaves it. */
export async function readFirstScreen(): Promise<FirstScreen> {
  return firstScreen(await AsyncStorage.getItem(STORAGE_KEYS.knownPlayer).catch(() => null));
}

// Neither the session nor /me says how a player signs in; only a sign-in knows.
let announced: SignInMethod | null = null;
let signedInWith: { id: string; method: SignInMethod } | null = null;
let written: string | null = null;
let writes = Promise.resolve();

/** Said by a sign-in just before it sets the session, so the record knows the way back in. */
export function signingInWith(method: SignInMethod) {
  announced = method;
}

/**
 * The only writer: the auth store calls it whenever its player is known or changes,
 * at app start too. A guest or no player writes nothing, so sign-out leaves the record.
 */
export function keepPlayer(user: User | null) {
  if (!user || user.guest) return;
  const method = announced ?? (signedInWith?.id === user.id ? signedInWith.method : null);
  announced = null;
  writes = writes.then(async () => {
    // A session from before this run: keep the record's way in if it is this player,
    // else the normal Sign in. The server sends nothing better to go on.
    const known = method ?? (await keptMethod(user)) ?? 'password';
    signedInWith = { id: user.id, method: known };
    const kept = keptPlayer(user, known);
    if (!kept || kept === written) return;
    written = kept;
    await AsyncStorage.setItem(STORAGE_KEYS.knownPlayer, kept).catch(() => {});
  });
}

async function keptMethod(user: User): Promise<SignInMethod | null> {
  const screen = firstScreen(
    await AsyncStorage.getItem(STORAGE_KEYS.knownPlayer).catch(() => null)
  );
  return screen.kind === 'known' && screen.player.name === user.username
    ? screen.player.method
    : null;
}

/** "Not you?" and Delete account. */
export function forgetPlayer(): Promise<void> {
  // After any write still on its way, so the record cannot come back.
  writes = writes.then(async () => {
    written = null;
    signedInWith = null;
    await AsyncStorage.removeItem(STORAGE_KEYS.knownPlayer).catch(() => {});
  });
  return writes;
}
