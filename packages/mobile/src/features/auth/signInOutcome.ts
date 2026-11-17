import type { ClassicFound } from '@/api/auth';

/**
 * Which screen follows a Sign in answer, by password, Apple or Facebook (PID-455).
 * Three answers lead on: signed in goes home; an old-Pidro account not moved yet asks
 * "Is this you?"; one already moved says that was the old password. Everything else
 * stays on Sign in: a name and password nobody knows says they don't match.
 */
export type SignInOutcome =
  | 'signed_in'
  | 'classic_found'
  | 'moved'
  | 'mismatch'
  | 'unknown_identity'
  | 'cancelled'
  | 'failed';

export type SignInAnswer =
  | { status: 'signed_in' }
  | { status: 'classic_found'; claim: Pick<ClassicFound, 'already_claimed'> }
  | { status: 'unknown_identity' | 'cancelled' }
  | { status: 'failure'; code?: string };

export function signInOutcome(answer: SignInAnswer): SignInOutcome {
  switch (answer.status) {
    case 'classic_found':
      return answer.claim.already_claimed ? 'moved' : 'classic_found';
    case 'failure':
      return answer.code === 'INVALID_CREDENTIALS' ? 'mismatch' : 'failed';
    default:
      return answer.status;
  }
}
