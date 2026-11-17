import { describe, expect, it } from 'bun:test';
import { signInOutcome } from '../../src/features/auth/signInOutcome.ts';
import { alreadyClaimedView } from '../../src/features/auth/classicClaimForm.ts';
import { signInEvent } from '../../src/features/analytics.ts';

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

describe('the moved screen for each way the account signs in now', () => {
  const view = (method, user = null) =>
    alreadyClaimedView({
      alreadyClaimed: moved(method),
      user,
      guestGames: 0,
      login: 'ThunderThor88',
    });

  it('password: Try again with the name kept, and the emailed link', () => {
    expect(view('password')).toMatchObject({
      login: 'ThunderThor88',
      forgot: true,
      moved: { on: '2026-11-03T10:00:00Z', sentence: 'auth.moved_password', provider: null },
    });
  });

  it("Apple or Facebook: that provider's button, no password help", () => {
    for (const method of ['apple', 'facebook']) {
      expect(view(method)).toMatchObject({
        login: undefined,
        forgot: false,
        moved: { sentence: `auth.moved_${method}`, provider: method },
      });
    }
  });

  it('unknown method: the date alone and Try again', () => {
    expect(view(null)).toMatchObject({
      forgot: false,
      moved: { sentence: 'auth.moved', provider: null },
    });
  });

  it('a saved account signed in on this phone keeps today\'s "sign out first" view', () => {
    expect(view('password', { guest: false, username: 'bengt' }).moved).toBeUndefined();
  });

  it('an answer without claimed_at (verify, Apple, Facebook) keeps "Already in Pidro"', () => {
    const view = alreadyClaimedView({
      alreadyClaimed: { sign_in_method: 'password' },
      user: null,
      guestGames: 0,
    });
    expect(view.moved).toBeUndefined();
    expect(view.hint).toBe('auth.signed_password');
  });
});

describe('sign-in events', () => {
  it('the three outcomes succeed, the rest fail, and nothing typed is sent', () => {
    for (const outcome of ['signed_in', 'classic_found', 'moved']) {
      expect(signInEvent('password', outcome)).toEqual([
        'sign_in_succeeded',
        { method: 'password', outcome },
      ]);
    }
    for (const outcome of ['mismatch', 'failed', 'unknown_identity', 'cancelled']) {
      expect(signInEvent('apple', outcome)).toEqual([
        'sign_in_failed',
        { method: 'apple', outcome },
      ]);
    }
  });
});
