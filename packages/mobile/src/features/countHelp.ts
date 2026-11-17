import type { User } from '@pidro/shared';

/**
 * Is count help on for this player (PID-451)? A choice made on this device wins.
 * Never chosen, an account from the old Pidro counts itself; everyone else,
 * guests and the signed-out included, gets Count for me.
 */
export function countHelpOn(
  choice: boolean | null,
  user: Pick<User, 'classic'> | null | undefined
): boolean {
  return choice ?? !user?.classic;
}
