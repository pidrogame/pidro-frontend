import { afterEach, describe, expect, test } from 'bun:test';
import appJson from '../app.json';
import makeConfig from '../app.config.js';

const NAMES = [
  'APP_VARIANT',
  'EXPO_PUBLIC_ADMOB_APP_ID_IOS',
  'EXPO_PUBLIC_ADMOB_APP_ID_ANDROID',
  'EXPO_PUBLIC_ADMOB_REWARDED_IOS',
  'EXPO_PUBLIC_ADMOB_REWARDED_ANDROID',
  'EXPO_PUBLIC_REVENUECAT_IOS_KEY',
  'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY',
  'GOOGLE_SERVICES_JSON',
];
NAMES.push(...NAMES.filter((name) => name.startsWith('EXPO_')).map((name) => `${name}_BETA`));
const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

function config(env) {
  for (const name of NAMES) delete process.env[name];
  Object.assign(process.env, env);
  const expo = makeConfig({ config: structuredClone(appJson.expo) });
  const plugin = (name) => expo.plugins.find((entry) => entry[0] === name)?.[1];
  return {
    expo,
    ads: plugin('react-native-google-mobile-ads'),
    push: plugin('expo-notifications'),
  };
}

const SAMPLE = {
  ios: 'ca-app-pub-3940256099942544~1458002511',
  android: 'ca-app-pub-3940256099942544~3347511713',
  rewardedIos: 'ca-app-pub-3940256099942544/1712485313',
  rewardedAndroid: 'ca-app-pub-3940256099942544/5224354917',
};
const REAL = {
  EXPO_PUBLIC_ADMOB_APP_ID_IOS: 'ca-app-pub-1111111111111111~2222222222',
  EXPO_PUBLIC_ADMOB_APP_ID_ANDROID: 'ca-app-pub-1111111111111111~3333333333',
};

describe('ad ids per variant', () => {
  test('development and beta fall back to Google samples, one platform at a time', () => {
    for (const [variant, suffix] of [
      ['development', ''],
      ['beta', '_BETA'],
    ]) {
      const { expo, ads } = config({
        APP_VARIANT: variant,
        [`EXPO_PUBLIC_ADMOB_APP_ID_IOS${suffix}`]: REAL.EXPO_PUBLIC_ADMOB_APP_ID_IOS,
        [`EXPO_PUBLIC_ADMOB_REWARDED_ANDROID${suffix}`]: 'ca-app-pub-1111111111111111/4444444444',
      });
      expect(ads.iosAppId).toBe(REAL.EXPO_PUBLIC_ADMOB_APP_ID_IOS);
      expect(ads.androidAppId).toBe(SAMPLE.android);
      expect(expo.extra.rewardedAdUnit).toEqual({
        ios: SAMPLE.rewardedIos,
        android: 'ca-app-pub-1111111111111111/4444444444',
      });
    }
    // No APP_VARIANT is the beta.
    expect(config({}).ads.iosAppId).toBe(SAMPLE.ios);
  });

  test("the beta shares production's EAS environment but never reads production's ids", () => {
    const { expo, ads } = config({
      APP_VARIANT: 'beta',
      ...REAL,
      EXPO_PUBLIC_ADMOB_REWARDED_IOS: 'ca-app-pub-1111111111111111/5555555555',
      EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_production',
      EXPO_PUBLIC_REVENUECAT_IOS_KEY_BETA: 'appl_beta',
    });
    expect([ads.iosAppId, ads.androidAppId]).toEqual([SAMPLE.ios, SAMPLE.android]);
    expect(expo.extra.rewardedAdUnit.ios).toBe(SAMPLE.rewardedIos);
    expect(expo.extra.revenueCatKey).toEqual({ ios: 'appl_beta', android: undefined });
  });

  test("production never reads the beta's names", () => {
    const { expo } = config({
      APP_VARIANT: 'production',
      ...REAL,
      EXPO_PUBLIC_REVENUECAT_IOS_KEY_BETA: 'appl_beta',
      EXPO_PUBLIC_ADMOB_REWARDED_IOS_BETA: 'ca-app-pub-1111111111111111/6666666666',
    });
    expect(expo.extra.revenueCatKey.ios).toBeUndefined();
    expect(expo.extra.rewardedAdUnit.ios).toBeUndefined();
  });

  test('production refuses to build without its app ids, naming the missing one', () => {
    expect(() => config({ APP_VARIANT: 'production' })).toThrow('EXPO_PUBLIC_ADMOB_APP_ID_IOS');
    expect(() =>
      config({
        APP_VARIANT: 'production',
        EXPO_PUBLIC_ADMOB_APP_ID_IOS: REAL.EXPO_PUBLIC_ADMOB_APP_ID_IOS,
      })
    ).toThrow('EXPO_PUBLIC_ADMOB_APP_ID_ANDROID');
  });

  test('production never ships a sample: no rewarded unit means no rewarded ads', () => {
    const { expo, ads } = config({ APP_VARIANT: 'production', ...REAL });
    expect(ads.iosAppId).toBe(REAL.EXPO_PUBLIC_ADMOB_APP_ID_IOS);
    expect(ads.androidAppId).toBe(REAL.EXPO_PUBLIC_ADMOB_APP_ID_ANDROID);
    expect(expo.extra.rewardedAdUnit).toEqual({ ios: undefined, android: undefined });
    expect(JSON.stringify(expo)).not.toContain('3940256099942544');
  });

  test('no tracking prompt and measurement waits, in every variant', () => {
    for (const env of [{ APP_VARIANT: 'development' }, { APP_VARIANT: 'production', ...REAL }]) {
      const { ads } = config(env);
      expect(ads).not.toHaveProperty('userTrackingUsageDescription');
      expect(ads.delayAppMeasurementInit).toBe(true);
    }
  });
});

describe('purchases and push config', () => {
  test('missing RevenueCat keys never fail a build; set keys reach extra per platform', () => {
    expect(config({ APP_VARIANT: 'production', ...REAL }).expo.extra.revenueCatKey).toEqual({
      ios: undefined,
      android: undefined,
    });
    const { expo } = config({
      APP_VARIANT: 'production',
      ...REAL,
      EXPO_PUBLIC_REVENUECAT_ANDROID_KEY: 'goog_production',
    });
    expect(expo.extra.revenueCatKey).toEqual({ ios: undefined, android: 'goog_production' });
    // The EAS project id and router config survive.
    expect(expo.extra.eas.projectId).toBe(appJson.expo.extra.eas.projectId);
    expect(expo.extra.router).toEqual(appJson.expo.extra.router);
  });

  test('the Firebase file is used only when its variable is set', () => {
    expect(config({}).expo.android).not.toHaveProperty('googleServicesFile');
    const file = '/tmp/eas/google-services.json';
    expect(config({ GOOGLE_SERVICES_JSON: file }).expo.android.googleServicesFile).toBe(file);
  });

  test('notifications use the navy accent and the default channel', () => {
    const { push } = config({});
    expect(push).toMatchObject({ color: '#07264c', defaultChannel: 'default' });
    expect(push).not.toHaveProperty('icon');
    // The beta and production get the production APNs environment; development, the sandbox.
    expect(push.mode).toBe('production');
    expect(config({ APP_VARIANT: 'development' }).push.mode).toBe('development');
  });
});
