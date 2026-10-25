import type { ClassicClaimAccount, ClassicClaimMethod, ClassicNewAccount } from '@pidro/shared';

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
