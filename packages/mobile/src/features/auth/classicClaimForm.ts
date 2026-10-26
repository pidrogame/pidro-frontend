import type {
  ClassicAlreadyClaimed,
  ClassicClaimAccount,
  ClassicClaimMethod,
  ClassicNewAccount,
} from '@pidro/shared';

export type LoginField = 'username' | 'email';

export interface ClaimForm {
  /** The inputs the player fills in. */
  asks: { username: boolean; email: boolean; password: boolean };
  /** The Classic login the new account gets, shown and never edited. */
  kept: Partial<Record<LoginField, string>>;
  /** The server took the login from Classic, so the screen says why a new password is asked. */
  fromClassic: boolean;
}

/**
 * What a claim asks for. A password claim by someone signed out or a guest
 * creates the Pidro login: the server offers the Classic username and email
 * (`new_account`), so only a new password and the values it couldn't offer are
 * typed. `refused` are offered values the claim answered as taken meanwhile.
 * A server without `new_account` gets today's username, email and password.
 */
export function claimForm({
  method,
  user,
  newAccount,
  refused = [],
}: {
  method: ClassicClaimMethod | null;
  user: { guest?: boolean | null } | null;
  newAccount?: ClassicNewAccount | null;
  refused?: LoginField[];
}): ClaimForm {
  const credentials = method === 'password' && (!user || Boolean(user.guest));
  const offered = credentials ? newAccount : null;
  const kept: ClaimForm['kept'] = {};
  for (const field of ['username', 'email'] as const) {
    const value = offered?.[field];
    if (value && !refused.includes(field)) kept[field] = value;
  }
  return {
    asks: {
      // A guest already has a username, so it is only asked for when the offered one was taken.
      username: !kept.username && (!user || Boolean(offered?.username)),
      email: credentials && !kept.email,
      password: credentials,
    },
    kept,
    fromClassic: Boolean(offered),
  };
}

/** Confirmation can claim immediately only when there is nothing left to type. */
export function claimNeedsDetails(form: ClaimForm, nameAllowed: boolean): boolean {
  return !nameAllowed || form.asks.username || form.asks.email || form.asks.password;
}

/** The `account` a claim sends: only what the player typed. */
export function claimAccount(
  form: ClaimForm,
  typed: { username: string; email: string; password: string; displayName: string },
  nameAllowed: boolean
): ClassicClaimAccount {
  return {
    ...(form.asks.username ? { username: typed.username.trim() } : {}),
    ...(form.asks.email ? { email: typed.email.trim() } : {}),
    ...(form.asks.password ? { password: typed.password } : {}),
    ...(!nameAllowed ? { display_name: typed.displayName.trim() } : {}),
  };
}

/** The offered value a claim refused as taken, so that one becomes an input. */
export function refusedLogin(form: ClaimForm, code: string | undefined): LoginField | null {
  if ((code === 'username' || code === 'USERNAME_TAKEN') && form.kept.username) return 'username';
  if ((code === 'email' || code === 'EMAIL_TAKEN') && form.kept.email) return 'email';
  return null;
}

export interface AlreadyClaimedView {
  /** How the owner signs in, as one line; null when the server doesn't say. */
  hint: 'auth.signed_password' | 'auth.signed_apple' | 'auth.signed_facebook' | null;
  /** The wood Sign in, for whoever signing in would not throw out a saved account. */
  signIn: boolean;
  /** The login Sign in and Forgot password start from: the verified Classic one, for a password owner. */
  login?: string;
  forgot: boolean;
  guestGamesLost: boolean;
  /** The other saved account this phone is signed in to, which has to sign out first. */
  signedInAs: string | null;
}

/**
 * What the screen offers for a Classic account another Pidro account owns.
 * Signing in replaces a guest, whose games stay behind, so a guest is told
 * that rather than kept out. A saved account is only told to sign out.
 */
export function alreadyClaimedView({
  alreadyClaimed,
  user,
  guestGames,
  login,
}: {
  alreadyClaimed: ClassicAlreadyClaimed | null;
  user: { guest?: boolean | null; username: string; display_name?: string | null } | null;
  guestGames: number;
  /** The Classic username or email the player verified with, if they typed one. */
  login?: string;
}): AlreadyClaimedView | null {
  if (!alreadyClaimed) return null;
  const method = alreadyClaimed.sign_in_method;
  const signIn = !user || Boolean(user.guest);
  const password = method === 'password' && signIn;
  return {
    hint: method ? (`auth.signed_${method}` as const) : null,
    signIn,
    login: password && login ? login : undefined,
    forgot: password,
    guestGamesLost: Boolean(user?.guest) && guestGames > 0,
    signedInAs: user && !user.guest ? user.display_name || user.username : null,
  };
}
