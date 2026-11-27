import { describe, expect, it } from 'bun:test';
import { claimFailure } from '../src/features/analytics.ts';

describe('claim_failed', () => {
  it('carries the method and the error code, nothing else', () => {
    expect(claimFailure('password', 'INVALID_CREDENTIALS')).toEqual({
      method: 'password',
      error_code: 'INVALID_CREDENTIALS',
    });
    expect(claimFailure('password', 'email')).toEqual({ method: 'password', error_code: 'email' });
  });

  it('never carries a message or anything the player typed', () => {
    for (const code of [
      'No Classic account for bengt@example.com',
      'hunter2!',
      'Sonja Lindqvist',
      'ThunderThor88',
      undefined,
      null,
      { message: 'secret' },
    ]) {
      expect(claimFailure('apple', code)).toEqual({ method: 'apple', error_code: 'unknown' });
    }
  });
});
