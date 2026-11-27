import { afterEach, describe, expect, it } from 'bun:test';
import { AxiosError } from 'axios';
import { setLocale, t } from '@pidro/shared';
import {
  guestSaveFailure,
  guestSaveFieldMessage,
  guestSaveMessage,
} from '../../src/features/auth/saveGuest';
import { classicHelpMailto, sendClassicHelp } from '../../src/features/auth/classicRecovery';
import { requestSocialCredential } from '../../src/features/auth/socialCredentials';
import { reconcileAge } from '../../src/features/onboarding/reconcileAge';

afterEach(() => setLocale('en'));

function apiFailure(data) {
  return new AxiosError('private server exception', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 422,
    statusText: 'Unprocessable Entity',
    headers: {},
    config: {},
    data,
  });
}

describe('account localization', () => {
  it('resolves an existing guest-save failure in the current language, never server detail', () => {
    setLocale('en');
    const failure = guestSaveFailure(
      apiFailure({ error_code: 'email_taken', message: 'secret detail' })
    );
    expect(failure.emailTaken).toBe(true);
    const english = guestSaveMessage(failure);
    setLocale('sv');
    const swedish = guestSaveMessage(failure);
    expect(swedish).not.toBe(english);
    expect(swedish).not.toMatch(/secret detail|private server exception/);
    expect(swedish).toMatch(/e-post/i);
  });

  it('retains field identity for old and new validation without exposing raw messages', () => {
    setLocale('sv');
    for (const data of [
      { errors: { email: ['has already been taken'], password: ['is invalid'] } },
      {
        field_errors: [
          { field: 'email', error_code: 'field_taken' },
          { field: 'password', error_code: 'field_invalid' },
        ],
      },
    ]) {
      const failure = guestSaveFailure(apiFailure(data));
      expect(Object.keys(failure.fields).sort()).toEqual(['email', 'password']);
      expect(JSON.stringify(failure.fields)).not.toMatch(/has already been taken|is invalid/);
    }
    const unknown = guestSaveFailure(new Error('private server exception'));
    expect(guestSaveMessage(unknown)).toBe(t('auth.save_failed'));
  });

  it('rerenders retained field failures with their actual codes and server counts', () => {
    setLocale('en');
    const failure = guestSaveFailure(
      apiFailure({
        errors: [
          { code: 'username', detail: 'private name diagnostic' },
          { code: 'password', detail: 'private password diagnostic' },
        ],
        field_errors: [
          { field: 'username', error_code: 'field_format' },
          { field: 'password', error_code: 'field_too_short', error_params: { count: 12 } },
        ],
      })
    );
    for (const locale of ['en', 'sv', 'en']) {
      setLocale(locale);
      expect(guestSaveFieldMessage(failure, 'displayName')).toBe(t('error.field_format'));
      expect(guestSaveFieldMessage(failure, 'displayName')).not.toBe(t('auth.name_taken'));
      expect(guestSaveFieldMessage(failure, 'password')).toBe(
        t('error.field_too_short', { count: 12 })
      );
      expect(guestSaveFieldMessage(failure, 'password')).not.toContain('8');
    }
  });

  it('offers sign-in recovery only for precise old or structured email uniqueness', () => {
    const legacy = { code: 'email', title: 'Email', detail: 'has already been taken' };
    const cases = [
      [{ errors: [legacy] }, true, 'auth.email_taken'],
      [{ errors: [{ ...legacy, detail: 'has invalid format' }] }, false, 'auth.check_email'],
      [
        { errors: [{ ...legacy, detail: 'private diagnostic has already been taken' }] },
        false,
        'auth.check_email',
      ],
      [{ error_code: 'email_taken' }, true, 'auth.email_taken'],
      [{ code: 'EMAIL_TAKEN' }, true, 'auth.email_taken'],
      ...[
        ['field_taken', true, 'auth.email_taken'],
        ['email_taken', true, 'auth.email_taken'],
        ['field_format', false, 'error.field_format'],
        ['future_validation', false, 'error.field_invalid'],
      ].map(([code, taken, key]) => [
        {
          errors: [legacy],
          field_errors: [{ field: 'email', error_code: code, error_params: {} }],
        },
        taken,
        key,
      ]),
    ];

    for (const [data, taken, key] of cases) {
      setLocale('en');
      const error = apiFailure(data);
      const failure = guestSaveFailure(error);
      expect(failure.originalError).toBe(error);
      expect(failure.emailTaken === true).toBe(taken);
      for (const locale of ['en', 'sv', 'en']) {
        setLocale(locale);
        expect(guestSaveFieldMessage(failure, 'email')).toBe(t(key));
        expect(guestSaveFailure(error).emailTaken === true).toBe(taken);
        expect(guestSaveFieldMessage(failure, 'email')).not.toMatch(
          /private|has already been taken/
        );
      }
    }
  });

  it('uses account name recovery copy for structured uniqueness and Classic reservation', () => {
    for (const field of ['username', 'display_name']) {
      for (const [code, key, reserved] of [
        ['field_taken', 'auth.name_taken', false],
        ['username_taken', 'auth.name_taken', false],
        ['classic_name_reserved', 'auth.name_taken', true],
        ['field_format', 'error.field_format', false],
        ['future_validation', 'error.field_invalid', false],
      ]) {
        const failure = guestSaveFailure(
          apiFailure({
            errors: [{ code: 'CLASSIC_NAME_RESERVED', detail: 'private legacy diagnostic' }],
            field_errors: [{ field, error_code: code, error_params: {} }],
          })
        );
        expect(failure.classicNameReserved === true).toBe(reserved);
        for (const locale of ['en', 'sv', 'en']) {
          setLocale(locale);
          expect(guestSaveFieldMessage(failure, 'displayName')).toBe(t(key));
          expect(guestSaveFailure(failure.originalError).classicNameReserved === true).toBe(
            reserved
          );
        }
      }
    }
  });

  it('keeps precise inline field codes and literal counts ahead of bare field names', () => {
    const failure = guestSaveFailure(
      apiFailure({
        errors: [
          { code: 'username', error_code: 'field_format', detail: 'private name diagnostic' },
          {
            code: 'password',
            error_code: 'field_too_long',
            error_params: { count: 73 },
            detail: 'private password diagnostic',
          },
        ],
      })
    );
    for (const locale of ['en', 'sv']) {
      setLocale(locale);
      expect(guestSaveFieldMessage(failure, 'displayName')).toBe(t('error.field_format'));
      expect(guestSaveFieldMessage(failure, 'password')).toBe(
        t('error.field_too_long', { count: 73 })
      );
      expect(guestSaveFieldMessage(failure, 'password')).toContain('73');
    }
  });

  it('keeps uncoded legacy fields safe and known domain overrides live', () => {
    const uncoded = guestSaveFailure(
      apiFailure({
        errors: {
          display_name: ['private name detail'],
          password: ['private password detail'],
        },
      })
    );
    const reserved = guestSaveFailure(apiFailure({ error_code: 'classic_name_reserved' }));
    const taken = guestSaveFailure(apiFailure({ code: 'EMAIL_TAKEN' }));
    const password = guestSaveFailure(apiFailure({ errors: [{ code: 'password' }] }));
    for (const locale of ['en', 'sv']) {
      setLocale(locale);
      expect(guestSaveFieldMessage(uncoded, 'displayName')).toBe(t('error.field_invalid'));
      expect(guestSaveFieldMessage(uncoded, 'password')).toBe(t('error.field_invalid'));
      expect(guestSaveFieldMessage(reserved, 'displayName')).toBe(t('auth.name_taken'));
      expect(reserved.classicNameReserved).toBe(true);
      expect(guestSaveFieldMessage(taken, 'email')).toBe(t('auth.email_taken'));
      expect(taken.emailTaken).toBe(true);
      expect(guestSaveFieldMessage(password, 'password')).toBe(t('error.field_invalid'));
    }
  });

  it('creates a fresh localized support email without translating player-supplied details', () => {
    const request = { name: 'Åsa', email: 'asa@example.com', details: 'My own words & symbols' };
    setLocale('en');
    const english = decodeURIComponent(classicHelpMailto(request));
    setLocale('sv');
    const swedish = decodeURIComponent(classicHelpMailto(request));
    expect(english).toContain('Name I played as: Åsa');
    expect(swedish).toContain('Namnet jag spelade med: Åsa');
    expect(swedish).toContain(request.details);
    expect(swedish).toContain(request.email);
  });

  it('returns reusable support and age error keys instead of server English', async () => {
    setLocale('sv');
    const rejected = await sendClassicHelp(
      { name: 'Åsa', email: 'a@b.co' },
      {
        send: async () => {
          throw apiFailure({ message: 'private detail' });
        },
        openMail: async () => {
          throw new Error('must not open mail');
        },
      }
    );
    expect(rejected.message).toBe(t('auth.check_details'));
    expect(rejected.messageKey).toBe('auth.check_details');
    const result = await reconcileAge(
      { age_band: '18_plus', terms_version: '1' },
      {
        setAge: async () => {
          throw new Error('private detail');
        },
        getMe: async () => {
          throw new Error('private detail');
        },
      }
    );
    expect(result.message).toBe(t('auth.age_save_failed'));
    expect(result.messageKey).toBe('auth.age_save_failed');
  });

  it('localizes native provider failures at invocation and preserves cancellation', async () => {
    setLocale('sv');
    const result = await requestSocialCredential('apple', {
      platform: 'ios',
      appleSignIn: async () => ({ identityToken: null, authorizationCode: null }),
      facebookSignIn: async () => ({ cancelled: true, credential: null }),
    });
    expect(result.message).toBe(t('auth.apple_token'));
    expect(result.messageKey).toBe('auth.apple_token');
    const cancelled = await requestSocialCredential('facebook', {
      platform: 'ios',
      appleSignIn: async () => ({ identityToken: null, authorizationCode: null }),
      facebookSignIn: async () => ({ cancelled: true, credential: null }),
    });
    expect(cancelled).toEqual({ status: 'cancelled', provider: 'facebook' });
  });
});
