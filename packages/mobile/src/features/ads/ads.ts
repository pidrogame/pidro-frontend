/**
 * Rewarded ads over react-native-google-mobile-ads. Thin and lazy: nothing starts the
 * SDK at launch, and every call answers 'unavailable' on web, in Expo Go and when this
 * build has no rewarded unit. Whether a player sees an ad is the server's decision;
 * this only knows how to show one.
 */
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { RewardedAd } from 'react-native-google-mobile-ads';

export type RewardedResult = 'earned' | 'dismissed' | 'unavailable';

const LOAD_TIMEOUT_MS = 15_000;
let started: Promise<void> | null = null;
let loaded: RewardedAd | null = null;
let lastError: string | null = null;

function unitId(): string | undefined {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return undefined;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return undefined;
  return Constants.expoConfig?.extra?.rewardedAdUnit?.[Platform.OS] || undefined;
}

export function adsAvailable(): boolean {
  return Boolean(unitId());
}

/** Why the last call answered 'unavailable', for the dev fixture. */
export function lastAdError(): string | null {
  return lastError;
}

// Required, not imported, so web and Expo Go never load the native module.
function sdk() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
}

function unavailable(error: unknown): 'unavailable' {
  lastError = error instanceof Error ? error.message : String(error);
  console.warn('[Ads]', lastError);
  return 'unavailable';
}

/** Call after ensureAdsConsent says ads may be requested, never before. */
export async function startAds(): Promise<'started' | 'unavailable'> {
  lastError = null;
  if (!adsAvailable()) return unavailable(new Error('Ads are not configured in this build'));
  const { default: mobileAds, MaxAdContentRating } = sdk();
  started ??= mobileAds()
    .setRequestConfiguration({ maxAdContentRating: MaxAdContentRating.PG })
    .then(() => mobileAds().initialize())
    .then(() => undefined);
  try {
    await started;
    return 'started';
  } catch (error) {
    started = null;
    return unavailable(error);
  }
}

/** Google's consent flow (UMP); resolves whether ads may be requested. */
export async function ensureAdsConsent(): Promise<boolean> {
  if (!adsAvailable()) return false;
  const { AdsConsent } = sdk();
  try {
    await AdsConsent.requestInfoUpdate();
    return (await AdsConsent.loadAndShowConsentFormIfRequired()).canRequestAds;
  } catch (error) {
    unavailable(error);
    return false;
  }
}

/** The privacy choices form, for Settings (PID-119). */
export async function showAdsPrivacyOptions(): Promise<'shown' | 'unavailable'> {
  if (!adsAvailable()) return 'unavailable';
  try {
    await sdk().AdsConsent.showPrivacyOptionsForm();
    return 'shown';
  } catch (error) {
    return unavailable(error);
  }
}

export async function loadRewarded(): Promise<'loaded' | 'unavailable'> {
  const unit = unitId();
  if (!unit) return 'unavailable';
  lastError = null;
  const { RewardedAd, RewardedAdEventType, AdEventType } = sdk();
  const ad = RewardedAd.createForAdRequest(unit, { requestNonPersonalizedAdsOnly: true });
  const result = await new Promise<'loaded' | Error>((resolve) => {
    const timer = setTimeout(() => done(new Error('No ad within 15 s')), LOAD_TIMEOUT_MS);
    const done = (value: 'loaded' | Error) => {
      clearTimeout(timer);
      offLoaded();
      offError();
      resolve(value);
    };
    const offLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => done('loaded'));
    const offError = ad.addAdEventListener(AdEventType.ERROR, (error) => done(error));
    try {
      ad.load();
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)));
    }
  });
  if (result !== 'loaded') return unavailable(result);
  loaded = ad;
  return 'loaded';
}

export async function showRewarded(): Promise<RewardedResult> {
  const ad = loaded;
  loaded = null;
  if (!ad) return unavailable(new Error('No rewarded ad is loaded'));
  const { RewardedAdEventType, AdEventType } = sdk();
  let earned = false;
  return new Promise<RewardedResult>((resolve) => {
    const offs = [
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      }),
      ad.addAdEventListener(AdEventType.CLOSED, () => finish(earned ? 'earned' : 'dismissed')),
      ad.addAdEventListener(AdEventType.ERROR, (error) => finish(unavailable(error))),
    ];
    function finish(result: RewardedResult) {
      offs.forEach((off) => off());
      resolve(result);
    }
    try {
      ad.show().catch((error: unknown) => finish(unavailable(error)));
    } catch (error) {
      finish(unavailable(error));
    }
  });
}
