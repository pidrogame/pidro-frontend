import type { AuthProvider, FacebookCredential } from '@/api/auth';
import { t, type TranslationKey } from '@pidro/shared';

export type SocialCredentialResult =
  | { status: 'success'; provider: 'apple'; token: string; authorizationCode?: string }
  | { status: 'success'; provider: 'facebook'; credential: FacebookCredential }
  | { status: 'cancelled'; provider: AuthProvider }
  | { status: 'failure'; provider: AuthProvider; message: string; messageKey?: TranslationKey };

export interface FacebookNativeModules {
  FBAccessToken?: unknown;
  FBAuthenticationToken?: unknown;
  FBLoginManager?: unknown;
}

interface FacebookLoginResult {
  isCancelled: boolean;
}

export interface FacebookSignInDependencies {
  platform: string;
  createNonce: () => string;
  logInWithPermissions: (
    permissions: string[],
    tracking: 'enabled' | 'limited',
    nonce?: string
  ) => Promise<FacebookLoginResult>;
  getAccessToken: () => Promise<string | null>;
  getAuthenticationToken: () => Promise<string | null>;
}

export function facebookNativeModulesLoaded(
  platform: string,
  modules: FacebookNativeModules
): boolean {
  return Boolean(
    modules.FBLoginManager &&
    (platform === 'ios' ? modules.FBAuthenticationToken : modules.FBAccessToken)
  );
}

export async function requestFacebookCredential(
  dependencies: FacebookSignInDependencies
): Promise<{ cancelled: boolean; credential: FacebookCredential | null }> {
  if (dependencies.platform === 'ios') {
    const nonce = dependencies.createNonce();
    const result = await dependencies.logInWithPermissions(
      ['public_profile', 'email'],
      'limited',
      nonce
    );
    if (result.isCancelled) return { cancelled: true, credential: null };

    const token = await dependencies.getAuthenticationToken();
    return {
      cancelled: false,
      credential: token ? { type: 'authentication_token', token, nonce } : null,
    };
  }

  const result = await dependencies.logInWithPermissions(['public_profile', 'email'], 'enabled');
  if (result.isCancelled) return { cancelled: true, credential: null };

  const token = await dependencies.getAccessToken();
  return {
    cancelled: false,
    credential: token ? { type: 'access_token', token } : null,
  };
}

export interface SocialCredentialDependencies {
  platform: string;
  /** Apple's one-time code lets the server revoke the account's Apple tokens at deletion. */
  appleSignIn: () => Promise<{ identityToken: string | null; authorizationCode: string | null }>;
  facebookSignIn: () => Promise<{ cancelled: boolean; credential: FacebookCredential | null }>;
}

export interface SocialProviderAvailability {
  apple: boolean;
  facebook: boolean;
}

function isAppleCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_REQUEST_CANCELED'
  );
}

/** Pure outcome mapping; the native SDK calls live in socialProviders.ts. */
export async function requestSocialCredential(
  provider: AuthProvider,
  resolvedDependencies: SocialCredentialDependencies
): Promise<SocialCredentialResult> {
  if (provider === 'apple' && resolvedDependencies.platform !== 'ios') {
    return {
      status: 'failure',
      provider,
      message: t('auth.apple_unavailable'),
      messageKey: 'auth.apple_unavailable',
    };
  }

  try {
    if (provider === 'apple') {
      const { identityToken: token, authorizationCode } = await resolvedDependencies.appleSignIn();
      if (!token) {
        return {
          status: 'failure',
          provider,
          message: t('auth.apple_token'),
          messageKey: 'auth.apple_token',
        };
      }
      return {
        status: 'success',
        provider,
        token,
        ...(authorizationCode ? { authorizationCode } : {}),
      };
    }

    const result = await resolvedDependencies.facebookSignIn();
    if (result.cancelled) return { status: 'cancelled', provider };
    if (!result.credential) {
      return {
        status: 'failure',
        provider,
        message: t('auth.facebook_token'),
        messageKey: 'auth.facebook_token',
      };
    }
    return { status: 'success', provider, credential: result.credential };
  } catch (error) {
    if (provider === 'apple' && isAppleCancellation(error)) {
      return { status: 'cancelled', provider };
    }
    if (
      provider === 'facebook' &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'FACEBOOK_UNAVAILABLE'
    ) {
      return {
        status: 'failure',
        provider,
        message: t('auth.facebook_unavailable'),
        messageKey: 'auth.facebook_unavailable',
      };
    }
    return {
      status: 'failure',
      provider,
      message: t('auth.social_failed', { provider }),
      messageKey: 'auth.social_failed',
    };
  }
}
