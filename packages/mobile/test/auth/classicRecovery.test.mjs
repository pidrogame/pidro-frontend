import { describe, expect, it } from 'bun:test';
import {
  classicHelpMailto,
  isSignInCode,
  requestClassicSignInCode,
  sendClassicHelp,
  verifyClassicSignInCode,
} from '../../src/features/auth/classicRecovery';
import { isEmailAddress } from '../../src/features/auth/accountEmail';
import { stash, take } from '../../src/features/auth/pendingClassicVerification';

const apiError = (status, code) => ({
  response: { status, data: code ? { errors: [{ code, detail: `${code} detail` }] } : {} },
});
const help = { name: 'Bengt', email: 'bengt@example.com', details: 'Played since 2014 & won' };

describe('Classic sign-in code', () => {
  it('returns the masked address the code went to', async () => {
    const result = await requestClassicSignInCode('Bengt', async (login) => {
      expect(login).toBe('Bengt');
      return { email_hint: 'be•••••@gmail.com' };
    });
    expect(result).toEqual({ status: 'sent', emailHint: 'be•••••@gmail.com' });
  });

  it('only reports a missing account when the server says so', async () => {
    const fail = (error) =>
      requestClassicSignInCode('Bengt', async () => {
        throw error;
      });
    expect(await fail(apiError(404, 'CLASSIC_ACCOUNT_NOT_FOUND'))).toEqual({ status: 'not_found' });
    expect(await fail(apiError(422, 'CLASSIC_EMAIL_MISSING'))).toEqual({ status: 'no_email' });
    expect(
      await fail({
        response: { status: 404, data: { error: { code: 'CLASSIC_ACCOUNT_NOT_FOUND' } } },
      })
    ).toEqual({ status: 'not_found' });
    expect(
      await fail({ response: { status: 422, data: { error: { code: 'CLASSIC_EMAIL_MISSING' } } } })
    ).toEqual({ status: 'no_email' });
    expect(await fail(apiError(429))).toEqual({ status: 'rate_limited' });
    // A server without the code service answers a bare 404.
    expect(await fail(apiError(404))).toEqual({ status: 'unavailable' });
    expect(await fail(apiError(503, 'PROVIDER_UNAVAILABLE'))).toEqual({ status: 'unavailable' });
    expect(await fail(new Error('Network Error'))).toEqual({ status: 'unavailable' });
  });

  it('accepts exactly six ASCII digits, including leading zeros', () => {
    for (const value of ['000001', '482917', '000000']) expect(isSignInCode(value)).toBe(true);
    for (const value of [
      '',
      '12345',
      '1234567',
      '12345\n',
      '123456\n',
      ' 123456',
      '123456 ',
      '１２３４５６',
      '12a456',
    ]) {
      expect(isSignInCode(value)).toBe(false);
    }
  });

  it('hands the complete verification to claim once, without changing the code', async () => {
    const verification = {
      ticket: 'ticket',
      expires_at: '2099-01-01T00:00:00Z',
      classic: {
        name: 'Bengt',
        games_played: 320,
        level: 12,
        member_since: null,
        name_allowed: true,
      },
      already_claimed: { sign_in_method: 'password' },
    };
    const result = await verifyClassicSignInCode('Bengt', '000017', async (login, code) => {
      expect([login, code]).toEqual(['Bengt', '000017']);
      return verification;
    });
    expect(result).toEqual({ status: 'verified', verification });
    stash(result.verification);
    expect(take()).toEqual(verification);
    expect(take()).toBeNull();
  });

  it('treats every unauthorized code as invalid, but distinguishes limits and outages', async () => {
    const fail = (error) =>
      verifyClassicSignInCode('Bengt', '132465', async () => {
        throw error;
      });
    expect(await fail(apiError(401, 'CLASSIC_CODE_INVALID'))).toEqual({ status: 'invalid' });
    expect(await fail(apiError(401))).toEqual({ status: 'invalid' });
    expect(await fail(apiError(429))).toEqual({ status: 'rate_limited' });
    for (const error of [apiError(404), apiError(503), new Error('Network Error')]) {
      expect(await fail(error)).toEqual({ status: 'unavailable' });
    }
  });
});

describe('Classic help request', () => {
  it('is sent to support when the server takes it', async () => {
    const opened = [];
    const result = await sendClassicHelp(help, {
      send: async () => undefined,
      openMail: async (url) => opened.push(url),
    });
    expect(result).toEqual({ status: 'sent' });
    expect(opened).toEqual([]);
  });

  it('opens the same message in the mail app when the server cannot take it', async () => {
    for (const error of [apiError(404), apiError(503), new Error('Network Error')]) {
      const opened = [];
      const result = await sendClassicHelp(help, {
        send: async () => {
          throw error;
        },
        openMail: async (url) => opened.push(url),
      });
      expect(result).toEqual({ status: 'mail' });
      expect(opened).toEqual([classicHelpMailto(help)]);
    }
  });

  it('keeps the player on the form when the server rejects the message', async () => {
    const opened = [];
    const deps = (error) => ({
      send: async () => {
        throw error;
      },
      openMail: async (url) => opened.push(url),
    });
    expect(await sendClassicHelp(help, deps(apiError(422, 'email')))).toEqual({
      status: 'rejected',
      message: 'Check your details and try again.',
      messageKey: 'auth.check_details',
      field: 'email',
    });
    expect(await sendClassicHelp(help, deps(apiError(422, 'name')))).toEqual({
      status: 'rejected',
      message: 'Check your details and try again.',
      messageKey: 'auth.check_details',
    });
    expect(await sendClassicHelp(help, deps(apiError(429)))).toEqual({
      status: 'rejected',
      message: 'Too many messages. Wait a minute and try again.',
      messageKey: 'auth.messages_limited',
    });
    expect(opened).toEqual([]);
  });

  it('fails only when neither the server nor a mail app is available', async () => {
    const result = await sendClassicHelp(help, {
      send: async () => {
        throw apiError(404);
      },
      openMail: async () => {
        throw new Error('No mail app');
      },
    });
    expect(result).toEqual({ status: 'failed' });
  });

  it('writes a readable message to support', () => {
    const url = new URL(classicHelpMailto(help));
    expect(url.pathname).toBe('support@pidro.net');
    expect(url.searchParams.get('subject')).toBe('Help finding my account in the old Pidro app');
    expect(url.searchParams.get('body')).toBe(
      'Name I played as: Bengt\nEmail to reach me: bengt@example.com\n\nPlayed since 2014 & won'
    );
  });
});

describe('account email', () => {
  it('accepts addresses and rejects usernames', () => {
    expect(isEmailAddress(' bengt@example.com ')).toBe(true);
    expect(isEmailAddress('Bengt')).toBe(false);
    expect(isEmailAddress('bengt@example')).toBe(false);
    expect(isEmailAddress('be ngt@example.com')).toBe(false);
  });
});
