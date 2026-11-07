# Purchases, ads and push: native SDKs (store build 3.3.0)

Store build 3.3.0 carries three native SDKs, wired up and quiet. The feature work
that uses them (premium PID-113/PID-126, ads PID-112, push PID-317) then ships over
the air. The adapters are `packages/mobile/src/features/premium/purchases.ts`,
`src/features/ads/ads.ts` and `src/features/push/push.ts`. All three do nothing on
web, in Expo Go, or when a build has no keys.

| SDK               | Package                          | Version                                           |
| ----------------- | -------------------------------- | ------------------------------------------------- |
| RevenueCat        | `react-native-purchases`         | `^11.0.1`                                         |
| Google Mobile Ads | `react-native-google-mobile-ads` | `~17.0.0` (17.1 and later need React Native 0.86) |
| Push              | `expo-notifications`             | `~56.0.26`                                        |

The server owns `premium` and the decision to show an ad. Nothing in the client
reads CustomerInfo to unlock anything.

## Environment variables

`app.config.js` reads these when it builds the native project, and again when
`eas update` exports a bundle: `extra` is part of every update's manifest. So each
variable must exist in the EAS environment for **both** the build and the update.

| Variable                                       | Read by                                     | Unset in development / beta      | Unset in production                   |
| ---------------------------------------------- | ------------------------------------------- | -------------------------------- | ------------------------------------- |
| `EXPO_PUBLIC_ADMOB_APP_ID_IOS`                 | `GADApplicationIdentifier` in Info.plist    | Google's sample app              | **Config fails**, naming the variable |
| `EXPO_PUBLIC_ADMOB_APP_ID_ANDROID`             | `com.google.android.gms.ads.APPLICATION_ID` | Google's sample app              | **Config fails**, naming the variable |
| `EXPO_PUBLIC_ADMOB_REWARDED_IOS`               | `extra.rewardedAdUnit.ios`                  | Google's test unit               | Rewarded ads unavailable              |
| `EXPO_PUBLIC_ADMOB_REWARDED_ANDROID`           | `extra.rewardedAdUnit.android`              | Google's test unit               | Rewarded ads unavailable              |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY`               | `extra.revenueCatKey.ios`                   | Purchases unavailable            | Purchases unavailable                 |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`           | `extra.revenueCatKey.android`               | Purchases unavailable            | Purchases unavailable                 |
| `GOOGLE_SERVICES_JSON` (EAS **file** variable) | `android.googleServicesFile`                | Android builds; push tokens fail | Same                                  |

Google's sample IDs (public, from Google's docs):

- App IDs: iOS `ca-app-pub-3940256099942544~1458002511`, Android
  `ca-app-pub-3940256099942544~3347511713`
- Rewarded units: iOS `ca-app-pub-3940256099942544/1712485313`, Android
  `ca-app-pub-3940256099942544/5224354917`

## Which EAS environment

`eas.json`: the `development` profile uses the `development` environment. The
`production` **and** `beta` profiles both use `production`, and so does the Beta
update workflow (`scripts/publish-beta.mjs`, `eas update --environment production`
with `APP_VARIANT=beta`). Beta and production are different RevenueCat apps (and
should be different AdMob apps), so one name cannot hold both keys.

**The fix:** the beta variant reads the same names with a `_BETA` suffix, and never
the plain names. In the EAS `production` environment, set:

- `EXPO_PUBLIC_REVENUECAT_IOS_KEY_BETA`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY_BETA`, and
  the plain `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`
  for production
- Optionally `EXPO_PUBLIC_ADMOB_*_BETA`. Unset, the beta keeps Google's samples,
  which is right until PID-112 ships real ads
- The plain `EXPO_PUBLIC_ADMOB_APP_ID_IOS` / `_ANDROID` before the first production
  build, or its config fails

In the EAS `development` environment, use the plain names (or nothing: samples, no
purchases).

Give them **plain text** or **sensitive** visibility, not secret: `eas update` must
read them to put them into `extra`. A missing variable at update time does not fail.
It quietly removes the key from that update, so the beta's purchases or ads stop
working until the next update that has it.

Per-profile `env` in `eas.json` was the other option. It was rejected because
`eas update` ignores build-profile `env`, so an over-the-air beta update would drop
the keys from `extra`. The variables are public client keys, but they still belong
in EAS, not in git.

`scripts/ship.mjs ota` publishes to the production channel with
`APP_VARIANT=production`. Before 3.3.0 it set no variant and resolved as the beta.
A production update now needs the production AdMob app IDs in the EAS environment,
just as the production build does.

## Firebase (Android push)

Expo push on Android goes through FCM. Download `google-services.json` for each
Android package (`com.oneapps.pidro.beta`, `com.oneapps.pidro`) from the Firebase
console. Upload it as an EAS **file** variable named `GOOGLE_SERVICES_JSON` in
`production`. Upload the FCM v1 service account key under Expo → Credentials →
Android. Until then the Android build succeeds, and `registerForPush` logs a token
failure without showing it. iOS push needs only the APNs key EAS manages.

The push token endpoint (PID-392) should upsert by token. A token that changes hands
(sign-out, then another player signs in on the same phone) is registered again under
the new player. A sign-out that cannot reach the server within 3 s leaves the old row
behind.

## Permissions this build never asks for

- No `NSUserTrackingUsageDescription` and no ATT prompt. Ads are requested
  non-personalized only, and app measurement is delayed
  (`delayAppMeasurementInit`).
- No notification-permission prompt. At start, an install that already allows
  notifications registers its token. PID-317 picks the moment to ask.

## Prebuild check

Run this in a scratch copy, never in the repository (`ios/` and `android/` are not
committed). From the monorepo root:

```bash
rm -rf /tmp/prebuild && mkdir /tmp/prebuild
tar --exclude=./node_modules --exclude='./packages/*/node_modules' --exclude=./.git -cf - . \
  | tar -xf - -C /tmp/prebuild
ln -s "$PWD/node_modules" /tmp/prebuild/node_modules
ln -s "$PWD/packages/mobile/node_modules" /tmp/prebuild/packages/mobile/node_modules
cd /tmp/prebuild/packages/mobile
EXPO_NO_DOTENV=1 bunx expo prebuild --platform ios --no-install
EXPO_NO_DOTENV=1 bunx expo prebuild --platform android --no-install

grep -A1 GADApplicationIdentifier ios/*/Info.plist         # the AdMob app id
grep -c NSUserTrackingUsageDescription ios/*/Info.plist    # 0
grep -A1 aps-environment ios/*/*.entitlements              # production (beta/production), development
grep gms.ads.APPLICATION_ID android/app/src/main/AndroidManifest.xml
```

Prefix `APP_VARIANT=production` (with the AdMob app IDs set) or
`APP_VARIANT=development` to check the other variants. Add
`GOOGLE_SERVICES_JSON=/path/to/google-services.json` to see the Firebase file copied
into `android/app` and the Google services Gradle plugin applied.

## Proving the ad path on a phone

A development build shows **Show a test ad** under Settings → About the app. It runs
`startAds`, `ensureAdsConsent`, `loadRewarded` and `showRewarded`, and prints
`earned`, `dismissed` or `unavailable` with the error. On web it says "Ads need a
phone".
