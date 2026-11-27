import { describe, expect, it } from 'bun:test';
import { signInOutcome } from '../../src/features/auth/signInOutcome.ts';

const preview = { name: 'ThunderThor88', games_played: 1284, level: 42, member_since: null };
const moved = (sign_in_method) => ({
  sign_in_method,
  claimed_at: '2026-11-03T10:00:00Z',
});

// One row per line of the PID-455 contract's table, as the app receives it.
describe('which screen follows a Sign in answer', () => {
  it('the new Pidro knows the name and password: signed in', () => {
    expect(signInOutcome({ status: 'signed_in', session: { token: 't', user: {} } })).toBe(
      'signed_in'
    );
  });

  it('only the old app knows them, not moved yet: "Is this you?"', () => {
    const claim = {
      classic_found: true,
      ticket: 'ticket',
      expires_at: '2026-11-17T12:10:00Z',
      classic: preview,
      already_claimed: null,
    };
    expect(signInOutcome({ status: 'classic_found', claim })).toBe('classic_found');
    // An older answer without the field is not a moved account either.
    const { already_claimed: _, ...older } = claim;
    expect(signInOutcome({ status: 'classic_found', claim: older })).toBe('classic_found');
  });

  it('only the old app knows them and the account moved: the moved screen, no ticket needed', () => {
    for (const method of ['password', 'apple', 'facebook', null]) {
      const claim = { classic_found: true, classic: preview, already_claimed: moved(method) };
      expect(signInOutcome({ status: 'classic_found', claim })).toBe('moved');
    }
  });

  it('nobody knows them, or the old app is down: "don\'t match", on Sign in', () => {
    expect(signInOutcome({ status: 'failure', code: 'INVALID_CREDENTIALS' })).toBe('mismatch');
  });

  it('any other refusal stays on Sign in with its own message', () => {
    for (const code of [undefined, 'RATE_LIMITED', 'AGE_NOT_ELIGIBLE']) {
      expect(signInOutcome({ status: 'failure', code })).toBe('failed');
    }
  });

  it('Apple and Facebook answers go through the same rule', () => {
    expect(signInOutcome({ status: 'unknown_identity' })).toBe('unknown_identity');
    expect(signInOutcome({ status: 'cancelled', provider: 'apple' })).toBe('cancelled');
    expect(signInOutcome({ status: 'failure', provider: 'facebook', message: 'x' })).toBe('failed');
  });
});
