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

// Google's sample AdMob app and rewarded ad unit ids. Every build but production falls
// back to them; see docs/native-sdks.md for where the real ones live.
const GOOGLE_SAMPLE_ADS = {
  EXPO_PUBLIC_ADMOB_APP_ID_IOS: 'ca-app-pub-3940256099942544~1458002511',
  EXPO_PUBLIC_ADMOB_APP_ID_ANDROID: 'ca-app-pub-3940256099942544~3347511713',
  EXPO_PUBLIC_ADMOB_REWARDED_IOS: 'ca-app-pub-3940256099942544/1712485313',
  EXPO_PUBLIC_ADMOB_REWARDED_ANDROID: 'ca-app-pub-3940256099942544/5224354917',
};

module.exports = ({ config }) => {
  // Default variant. Until the public launch every build that does not say
  // otherwise is the side-by-side Beta (com.oneapps.pidro.beta). Flip this back
  // to 'production' when the new game takes over Classic's identity
  // (com.oneapps.pidro) in the stores.
  const variant = process.env.APP_VARIANT ?? 'beta';
  const selectedVariant = variants[variant];
  const isProduction = variant === 'production';
  const facebookClientToken = process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN;
  // Store-distributed builds (production and the Beta) verify invite links and
  // block the permissions the store review flags; dev builds keep both empty.
  const isStoreBuild = isProduction || variant === 'beta';
  if (!selectedVariant) {
    throw new Error(`Unsupported APP_VARIANT: ${JSON.stringify(variant)}`);
  }
  // Beta and production are different RevenueCat and AdMob apps that share the EAS
  // `production` environment, builds and beta updates alike. The beta reads its own
  // names (EXPO_PUBLIC_…_BETA), never production's. See docs/native-sdks.md.
  const env = (name) => process.env[variant === 'beta' ? `${name}_BETA` : name] || undefined;
  // Production never ships Google's samples: without its AdMob app ids the build
  // stops here; without a rewarded unit, ads are unavailable.
  const ads = (name, { required = false } = {}) => {
    if (env(name)) return env(name);
    if (!isProduction) return GOOGLE_SAMPLE_ADS[name];
    if (required) throw new Error(`${name} must be set for the production build.`);
    return undefined;
  };
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;

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
    // No userTrackingUsageDescription: no tracking string and no ATT prompt, ever.
    [
      'react-native-google-mobile-ads',
      {
        iosAppId: ads('EXPO_PUBLIC_ADMOB_APP_ID_IOS', { required: true }),
        androidAppId: ads('EXPO_PUBLIC_ADMOB_APP_ID_ANDROID', { required: true }),
        delayAppMeasurementInit: true,
        // The plugin has no default list; this is Google's own network.
        skAdNetworkItems: ['cstr6suwn9.skadnetwork'],
      },
    ],
    [
      'expo-notifications',
      {
        color: '#07264c',
        defaultChannel: 'default',
        mode: isStoreBuild ? 'production' : 'development',
      },
    ],
  ];

  return {
    ...config,
    name: selectedVariant.name,
    scheme: selectedVariant.scheme,
    plugins,
    extra: {
      ...config.extra,
      variant,
      // Read by src/features/ads and src/features/premium through expo-constants.
      rewardedAdUnit: {
        ios: ads('EXPO_PUBLIC_ADMOB_REWARDED_IOS'),
        android: ads('EXPO_PUBLIC_ADMOB_REWARDED_ANDROID'),
      },
      // Unset means purchases are unavailable, never a failed build.
      revenueCatKey: {
        ios: env('EXPO_PUBLIC_REVENUECAT_IOS_KEY'),
        android: env('EXPO_PUBLIC_REVENUECAT_ANDROID_KEY'),
      },
    },
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
      // An EAS file variable. Without it Android builds, but cannot get a push token.
      ...(googleServicesFile ? { googleServicesFile } : {}),
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
