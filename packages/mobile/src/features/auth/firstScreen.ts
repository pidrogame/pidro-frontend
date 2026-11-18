import type { AuthProvider, User } from '@/api/auth';

export type SignInMethod = 'password' | AuthProvider;

/** Who last signed in on this phone: what "Welcome back" needs, nothing a sign-in needs. */
export interface KnownPlayer {
  name: string;
  avatarUrl: string | null;
  face: 'a' | 'b' | null;
  method: SignInMethod;
}

export type FirstScreen = { kind: 'known'; player: KnownPlayer } | { kind: 'new' };

const METHODS: readonly SignInMethod[] = ['password', 'apple', 'facebook'];

/** The record a sign-in leaves. A guest has no way back in, so the phone keeps none. */
export function keptPlayer(user: User, method: SignInMethod): string | null {
  if (user.guest || !user.username?.trim()) return null;
  const player: KnownPlayer = {
    name: user.username,
    avatarUrl: user.avatar_url ?? null,
    face: user.avatar_face ?? null,
    method,
  };
  return JSON.stringify(player);
}

/**
 * Which first screen this phone shows (PID-456): "Welcome back" for the player
 * it kept, the normal one for anything else, including a record it cannot read.
 */
export function firstScreen(stored: string | null): FirstScreen {
  let kept: Partial<KnownPlayer> | null;
  try {
    kept = JSON.parse(stored ?? 'null');
  } catch {
    return { kind: 'new' };
  }
  if (
    typeof kept?.name !== 'string' ||
    !kept.name.trim() ||
    !METHODS.includes(kept.method as SignInMethod)
  )
    return { kind: 'new' };
  return {
    kind: 'known',
    player: {
      name: kept.name,
      avatarUrl: typeof kept.avatarUrl === 'string' ? kept.avatarUrl : null,
      face: kept.face === 'a' || kept.face === 'b' ? kept.face : null,
      method: kept.method as SignInMethod,
    },
  };
}
