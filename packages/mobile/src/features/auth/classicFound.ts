import type { ClassicFound, AuthProvider } from '@/api/auth';
import type { ClassicClaimMethod, ClassicVerification } from '@/api/classic';

interface PendingClassicClaim {
  method: ClassicClaimMethod;
  verification: ClassicVerification;
  /** What a password Sign in typed, so the claim reuses it as the old-account form does. */
  login?: string;
  password?: string;
}

let pendingClaim: PendingClassicClaim | null = null;

/** Keeps the short-lived ticket out of navigation URLs while the claim screen opens. */
export function handleClassicFound(
  claim: ClassicFound,
  method: AuthProvider | 'password',
  typed?: { login: string; password: string }
): void {
  // The typed password only goes on to a claim; an account already moved keeps just the name.
  pendingClaim = {
    method,
    login: typed?.login,
    password: claim.ticket ? typed?.password : undefined,
    verification: classicVerification(claim),
  };
}

/** A sign-in's answer for an old-Pidro account, as the claim screen holds a verification. */
export function classicVerification(claim: ClassicFound): ClassicVerification {
  return {
    // An account already moved comes without a ticket; nothing claims it.
    ticket: claim.ticket ?? '',
    expires_at: claim.expires_at ?? '',
    classic: {
      name: claim.classic.name,
      games_played: claim.classic.games_played,
      level: claim.classic.level,
      member_since: claim.classic.member_since,
      // Older provider responses omitted this field. Requiring a new public
      // name is the safe fallback until the server explicitly allows it.
      name_allowed: claim.classic.name_allowed === true,
      new_account: claim.classic.new_account ?? null,
    },
    already_claimed: claim.already_claimed ?? null,
  };
}

export function takePendingClassicClaim(): PendingClassicClaim | null {
  const claim = pendingClaim;
  pendingClaim = null;
  return claim;
}
