import { expect, mock, test } from 'bun:test';

// The adapter over a mocked SDK. Module mocks would leak into other suites, so it runs in a child.
test('the ad adapter answers unavailable instead of throwing, and never shows a stale ad', async () => {
  if (!process.env.ADS_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, ADS_CHILD: '1' },
    });
    expect(child.stderr.toString()).not.toContain('(fail)');
    expect(child.exitCode).toBe(0);
    return;
  }
  let sdkMissing = true;
  const loads = [];
  mock.module('react-native', () => ({ Platform: { OS: 'ios' } }));
  mock.module('expo-constants', () => ({
    default: {
      executionEnvironment: 'standalone',
      expoConfig: { extra: { rewardedAdUnit: { ios: 'unit' } } },
    },
    ExecutionEnvironment: { StoreClient: 'storeClient' },
  }));
  // The adapter requires the SDK, which resolves to its CommonJS entry: mock that file.
  const { createRequire } = await import('node:module');
  const entry = createRequire(new URL('../../src/features/ads/ads.ts', import.meta.url)).resolve(
    'react-native-google-mobile-ads'
  );
  mock.module(entry, () => {
    const on = (ad) => (type, listener) => {
      ad.listeners[type] = listener;
      return () => {};
    };
    const sdk = {
      // A binary without the native module throws on the first call into it.
      default: () => {
        if (sdkMissing) throw new Error('RNGoogleMobileAdsModule could not be found');
        return { setRequestConfiguration: async () => {}, initialize: async () => {} };
      },
      MaxAdContentRating: { PG: 'PG' },
      AdsConsentPrivacyOptionsRequirementStatus: { REQUIRED: 'REQUIRED' },
      AdsConsent: {
        // Unknown until the info is updated in this session, as on a relaunch.
        getConsentInfo: async () => ({ privacyOptionsRequirementStatus: 'UNKNOWN' }),
        requestInfoUpdate: () => {
          if (sdkMissing) throw new Error('RNGoogleMobileAdsModule could not be found');
          return Promise.resolve({ privacyOptionsRequirementStatus: 'REQUIRED' });
        },
      },
      RewardedAdEventType: { LOADED: 'loaded', EARNED_REWARD: 'earned' },
      AdEventType: { ERROR: 'error', CLOSED: 'closed' },
      RewardedAd: {
        createForAdRequest: () => {
          const ad = { listeners: {}, load: () => loads.push(ad), show: async () => {} };
          ad.addAdEventListener = on(ad);
          return ad;
        },
      },
    };
    return sdk;
  });
  const ads = await import('../../src/features/ads/ads.ts');

  // A build whose binary lacks the SDK: every step says unavailable, none throws.
  expect(await ads.ensureAdsConsent()).toBe(false);
  expect(await ads.startAds()).toBe('unavailable');

  sdkMissing = false;
  expect(await ads.startAds()).toBe('started');
  expect(await ads.adsPrivacyOptionsRequired()).toBe(true);

  // A sheet closed while its ad loads: the ad that arrives later is never shown.
  const late = ads.loadRewarded();
  ads.resetAds();
  loads[0].listeners.loaded();
  expect(await late).toBe('unavailable');
  expect(await ads.showRewarded()).toBe('unavailable');
});
