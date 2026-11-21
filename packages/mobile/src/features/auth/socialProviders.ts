import { NativeModules, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  facebookNativeModulesLoaded,
  requestFacebookCredential,
  requestSocialCredential,
  type SocialCredentialResult,
  type SocialProviderAvailability,
} from './socialCredentials';
import { e2eSocialAvailability, e2eSocialCredential } from './e2eProviders';
import type { AuthProvider, FacebookCredential } from '@/api/auth';

export const facebookConfigured = Boolean(process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN);

/**
 * react-native-fbsdk-next builds a NativeEventEmitter from its native module
 * as soon as it is imported. On the New Architecture that module can be null,
 * and the import then throws outside any promise and kills the app. So never
 * import the package unless the module is there.
 *
 * React Native itself is imported statically on purpose: `await
 * import('react-native')` evaluates every export, including the deprecated
 * PushNotificationIOS, whose missing native module crashed the 3.2.0 Beta the
 * moment the sign-in screen opened.
 */
function facebookNativeModuleLoaded(): boolean {
  return facebookNativeModulesLoaded(Platform.OS, NativeModules);
}

async function appleSignIn() {
  const AppleAuthentication = await import('expo-apple-authentication');
  const { identityToken, authorizationCode } = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
  });
  return { identityToken, authorizationCode };
}

async function facebookSignIn(): Promise<{
  cancelled: boolean;
  credential: FacebookCredential | null;
}> {
  if (!facebookNativeModuleLoaded()) {
    throw Object.assign(new Error('FACEBOOK_UNAVAILABLE'), { code: 'FACEBOOK_UNAVAILABLE' });
  }
  const { AccessToken, AuthenticationToken, LoginManager, Settings } =
    await import('react-native-fbsdk-next');
  Settings.initializeSDK();
  return requestFacebookCredential({
    platform: Platform.OS,
    createNonce: () => Crypto.randomUUID().replaceAll('-', ''),
    logInWithPermissions: (permissions, tracking, nonce) =>
      LoginManager.logInWithPermissions(permissions, tracking, nonce),
    getAccessToken: async () => (await AccessToken.getCurrentAccessToken())?.accessToken ?? null,
    getAuthenticationToken: async () =>
      (await AuthenticationToken.getAuthenticationTokenIOS())?.authenticationToken ?? null,
  });
}

export async function getSocialProviderAvailability(): Promise<SocialProviderAvailability> {
  const e2e = e2eSocialAvailability();
  if (e2e) return e2e;

  let apple = false;
  if (Platform.OS === 'ios') {
    const AppleAuthentication = await import('expo-apple-authentication');
    apple = await AppleAuthentication.isAvailableAsync().catch(() => false);
  }

  // The SDK itself starts only when the player taps Facebook.
  const facebook =
    (Platform.OS === 'ios' || Platform.OS === 'android') &&
    facebookConfigured &&
    facebookNativeModuleLoaded();

  return { apple, facebook };
}

/** Runs the native Apple or Facebook sign-in and maps its outcome. */
export async function requestNativeSocialCredential(
  provider: AuthProvider
): Promise<SocialCredentialResult> {
  const e2e = await e2eSocialCredential(provider);
  if (e2e) return e2e;

  return requestSocialCredential(provider, {
    platform: Platform.OS,
    appleSignIn,
    facebookSignIn,
  });
}
