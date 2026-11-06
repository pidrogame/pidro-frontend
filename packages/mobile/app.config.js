// Default variant. Until the public launch every build that does not say
// otherwise is the side-by-side Beta (com.oneapps.pidro.beta). Flip this back
// to 'production' when the new game takes over Classic's identity
// (com.oneapps.pidro) in the stores.
const variant = process.env.APP_VARIANT ?? 'beta';

const variants = {
  production: {
    name: 'Pidro',
    scheme: 'pidro-mobile',
    bundleIdentifier: 'com.oneapps.pidro',
  },
  development: {
    name: 'Pidro Dev',
    scheme: 'pidro-mobile-dev',
    bundleIdentifier: 'com.marcelfahle.pidro3.dev',
  },
  // Side-by-side TestFlight/Play build for the Classic cohort. Own App Store
  // Connect record (6816832730); App ID grouped under com.oneapps.pidro for
  // Sign in with Apple so identities match Classic. See PID-143.
  beta: {
    name: 'Pidro Beta',
    scheme: 'pidro-mobile-beta',
    bundleIdentifier: 'com.oneapps.pidro.beta',
  },
};

module.exports = ({ config }) => {
  const selectedVariant = variants[variant];
  const isProduction = variant === 'production';
  const facebookClientToken = process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN;
  // Store-distributed builds (production and the Beta) verify invite links and
  // block the permissions the store review flags; dev builds keep both empty.
  const isStoreBuild = isProduction || variant === 'beta';
  if (!selectedVariant) {
    throw new Error(`Unsupported APP_VARIANT: ${JSON.stringify(variant)}`);
  }

  // The Facebook SDK is linked into every build and starts from the app
  // delegate, so it always needs its app ID and the auto-logging switches off,
  // even when no client token is set (the app then hides the button).
  const plugins = [
    ...(config.plugins ?? []),
    'expo-apple-authentication',
    [
      'react-native-fbsdk-next',
      {
        appID: '345200965110578',
        ...(facebookClientToken ? { clientToken: facebookClientToken } : {}),
        displayName: 'Pidro',
        scheme: 'fb345200965110578',
        advertiserIDCollectionEnabled: false,
        autoLogAppEventsEnabled: false,
        isAutoInitEnabled: false,
        iosUserTrackingPermission: false,
      },
    ],
  ];

  return {
    ...config,
    name: selectedVariant.name,
    scheme: selectedVariant.scheme,
    plugins,
    ios: {
      ...config.ios,
      bundleIdentifier: selectedVariant.bundleIdentifier,
      associatedDomains: ['applinks:www.pidro.online', 'applinks:pidro.online'],
      usesAppleSignIn: true,
    },
    android: {
      ...config.android,
      allowBackup: false,
      package: selectedVariant.bundleIdentifier,
      ...(isStoreBuild
        ? {
            blockedPermissions: [
              'android.permission.READ_EXTERNAL_STORAGE',
              'android.permission.SYSTEM_ALERT_WINDOW',
              'android.permission.WRITE_EXTERNAL_STORAGE',
            ],
            // The paths the AASA lists for iOS: invites, player links, legacy
            // links. One filter per host: Android 12+ verifies each host on its
            // own, and pairs every host in a filter with every path.
            intentFilters: ['www.pidro.online', 'pidro.online'].map((host) => ({
              action: 'VIEW',
              autoVerify: true,
              data: ['/j/', '/play/', '/app/'].map((pathPrefix) => ({
                scheme: 'https',
                host,
                pathPrefix,
              })),
              category: ['BROWSABLE', 'DEFAULT'],
            })),
          }
        : { blockedPermissions: [], intentFilters: [] }),
    },
  };
};
