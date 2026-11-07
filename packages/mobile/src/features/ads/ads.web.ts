/** The web has no ads. Metro picks this file over ads.ts there, so the SDK is never bundled. */
import type * as Ads from './ads';

export type { RewardedResult } from './ads';

const unavailable = async () => 'unavailable' as const;
export const adsAvailable: typeof Ads.adsAvailable = () => false;
export const lastAdError: typeof Ads.lastAdError = () => 'Ads need a phone';
export const startAds: typeof Ads.startAds = unavailable;
export const ensureAdsConsent: typeof Ads.ensureAdsConsent = async () => false;
export const showAdsPrivacyOptions: typeof Ads.showAdsPrivacyOptions = unavailable;
export const loadRewarded: typeof Ads.loadRewarded = unavailable;
export const showRewarded: typeof Ads.showRewarded = unavailable;
