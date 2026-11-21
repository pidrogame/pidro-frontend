import { describe, expect, it } from 'bun:test';

const { facebookNativeModulesLoaded, requestFacebookCredential, requestSocialCredential } =
  await import('../../src/features/auth/socialCredentials.ts');

const dependencies = (overrides = {}) => ({
  platform: 'ios',
  appleSignIn: async () => ({ identityToken: 'apple-token', authorizationCode: 'apple-code' }),
  facebookSignIn: async () => ({
    cancelled: false,
    credential: { type: 'access_token', token: 'facebook-token' },
  }),
  ...overrides,
});

describe('social credential helper', () => {
  it('returns real provider tokens without transforming them', async () => {
    expect(await requestSocialCredential('apple', dependencies())).toEqual({
      status: 'success',
      provider: 'apple',
      token: 'apple-token',
      authorizationCode: 'apple-code',
    });
    expect(await requestSocialCredential('facebook', dependencies())).toEqual({
      status: 'success',
      provider: 'facebook',
      credential: { type: 'access_token', token: 'facebook-token' },
    });
  });

  it('signs in with Apple without a one-time code, but never without an identity token', async () => {
    expect(
      await requestSocialCredential(
        'apple',
        dependencies({
          appleSignIn: async () => ({ identityToken: 'apple-token', authorizationCode: null }),
        })
      )
    ).toStrictEqual({ status: 'success', provider: 'apple', token: 'apple-token' });
    expect(
      await requestSocialCredential(
        'apple',
        dependencies({
          appleSignIn: async () => ({ identityToken: null, authorizationCode: 'apple-code' }),
        })
      )
    ).toMatchObject({ status: 'failure', provider: 'apple', messageKey: 'auth.apple_token' });
  });

  it('keeps Apple and Facebook cancellation silent and typed', async () => {
    expect(
      await requestSocialCredential(
        'apple',
        dependencies({
          appleSignIn: async () => {
            throw { code: 'ERR_REQUEST_CANCELED' };
          },
        })
      )
    ).toEqual({ status: 'cancelled', provider: 'apple' });
    expect(
      await requestSocialCredential(
        'facebook',
        dependencies({
          facebookSignIn: async () => ({ cancelled: true, credential: null }),
        })
      )
    ).toEqual({ status: 'cancelled', provider: 'facebook' });
  });

  it('reports provider failures and refuses missing tokens', async () => {
    expect(
      await requestSocialCredential(
        'facebook',
        dependencies({
          facebookSignIn: async () => ({ cancelled: false, credential: null }),
        })
      )
    ).toMatchObject({ status: 'failure', provider: 'facebook' });
    expect(
      await requestSocialCredential(
        'apple',
        dependencies({
          appleSignIn: async () => {
            throw new Error('provider unavailable');
          },
        })
      )
    ).toMatchObject({ status: 'failure', provider: 'apple' });
  });

  it('uses Limited Login with a fresh nonce on iOS', async () => {
    const calls = [];
    const credential = await requestFacebookCredential({
      platform: 'ios',
      createNonce: () => '0123456789abcdef0123456789abcdef',
      logInWithPermissions: async (...args) => {
        calls.push(args);
        return { isCancelled: false };
      },
      getAccessToken: async () => {
        throw new Error('iOS must not read a Graph access token');
      },
      getAuthenticationToken: async () => 'signed-identity-token',
    });

    expect(calls).toEqual([
      [['public_profile', 'email'], 'limited', '0123456789abcdef0123456789abcdef'],
    ]);
    expect(credential).toEqual({
      cancelled: false,
      credential: {
        type: 'authentication_token',
        token: 'signed-identity-token',
        nonce: '0123456789abcdef0123456789abcdef',
      },
    });
  });

  it('keeps Graph access-token login on Android', async () => {
    const calls = [];
    const credential = await requestFacebookCredential({
      platform: 'android',
      createNonce: () => {
        throw new Error('Android must not create a nonce');
      },
      logInWithPermissions: async (...args) => {
        calls.push(args);
        return { isCancelled: false };
      },
      getAccessToken: async () => 'graph-access-token',
      getAuthenticationToken: async () => {
        throw new Error('Android must not read an authentication token');
      },
    });

    expect(calls).toEqual([[['public_profile', 'email'], 'enabled']]);
    expect(credential).toEqual({
      cancelled: false,
      credential: { type: 'access_token', token: 'graph-access-token' },
    });
  });

  it('requires the credential module used by each platform', () => {
    expect(
      facebookNativeModulesLoaded('ios', {
        FBLoginManager: {},
        FBAccessToken: {},
      })
    ).toBe(false);
    expect(
      facebookNativeModulesLoaded('ios', {
        FBLoginManager: {},
        FBAuthenticationToken: {},
      })
    ).toBe(true);
    expect(
      facebookNativeModulesLoaded('android', {
        FBLoginManager: {},
        FBAccessToken: {},
      })
    ).toBe(true);
  });

  it('surfaces the existing unavailable-build message', async () => {
    expect(
      await requestSocialCredential(
        'facebook',
        dependencies({
          facebookSignIn: async () => {
            throw Object.assign(new Error('FACEBOOK_UNAVAILABLE'), {
              code: 'FACEBOOK_UNAVAILABLE',
            });
          },
        })
      )
    ).toEqual({
      status: 'failure',
      provider: 'facebook',
      message: 'Facebook sign-in is unavailable in this build.',
      messageKey: 'auth.facebook_unavailable',
    });
  });
});
