/**
 * The Premium sheet's rules (PID-126): which plans it sells, what it shows after an answer,
 * and where its doors are. Prices, periods and currencies always come from the store.
 */
import type { PremiumFields, TranslationKey } from '@pidro/shared';
import type { PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import type { BuyOutcome, RestoreOutcome } from './premium';

export const PREMIUM_OFFERING = 'pidro_premium';

export type PlanId = 'yearly' | 'monthly';
export type Plan = { id: PlanId; pkg: PurchasesPackage; price: string; perMonth: string | null };
export type SheetDoor = 'settings' | 'ad';
export type SheetStep =
  'loading' | 'choose' | 'buying' | 'restoring' | 'failed' | 'bought' | 'waiting' | 'empty';
export type SheetNotice = 'notFound' | 'restoreFailed' | null;
type Offerings = Pick<PurchasesOfferings, 'all' | 'current'>;

const PLANS: [PlanId, string][] = [
  ['yearly', 'ANNUAL'],
  ['monthly', 'MONTHLY'],
];

/** Yearly, then monthly. Any other package in the offering waits for its own ticket. */
export function premiumPlans(offerings: Offerings | null, locale: string): Plan[] {
  const offering = offerings?.all[PREMIUM_OFFERING] ?? offerings?.current;
  return PLANS.flatMap(([id, type]) => {
    const pkg = offering?.availablePackages.find((item) => item.packageType === type);
    if (!pkg) return [];
    const { price, priceString, pricePerMonthString, currencyCode } = pkg.product;
    const perMonth =
      id === 'yearly' ? pricePerMonthString || monthly(price, currencyCode, locale) : null;
    return [{ id, pkg, price: priceString, perMonth }];
  });
}

// The note is a nicety: an engine that cannot format the currency drops it, not the plan.
function monthly(price: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(price / 12);
  } catch {
    return null;
  }
}

/** What the sheet shows once the store and the server have answered. */
export function sheetAfter(
  kind: 'buy' | 'restore',
  outcome: BuyOutcome | RestoreOutcome
): { step: SheetStep; notice: SheetNotice } {
  if (outcome === 'bought' || outcome === 'restored') return { step: 'bought', notice: null };
  if (outcome === 'waiting') return { step: 'waiting', notice: null };
  if (kind === 'buy') return { step: outcome === 'failed' ? 'failed' : 'choose', notice: null };
  return { step: 'choose', notice: outcome === 'notFound' ? 'notFound' : 'restoreFailed' };
}

/** From the ad ticket, done deals the solo game the player asked for. */
export function doneKey(door: SheetDoor): TranslationKey {
  return door === 'ad' ? 'premium.sheet.deal' : 'premium.sheet.done';
}

/** Only a player the server says has no Premium, in a build that can sell it. */
export function canBuyPremium(user: Partial<PremiumFields> | null | undefined, available: boolean) {
  return available && user?.premium === false;
}

const fixturePackage = (packageType: string, product: Record<string, unknown>) =>
  ({
    identifier: `$rc_${packageType.toLowerCase()}`,
    packageType,
    product: { currencyCode: 'USD', pricePerMonthString: null, ...product },
  }) as unknown as PurchasesPackage;

// Made up, out of order, with a one-time package the sheet must ignore.
const fixtureOfferings = {
  current: null,
  all: {
    [PREMIUM_OFFERING]: {
      availablePackages: [
        fixturePackage('MONTHLY', { price: 4.99, priceString: '$4.99' }),
        fixturePackage('LIFETIME', { price: 119.99, priceString: '$119.99' }),
        fixturePackage('ANNUAL', {
          price: 24.99,
          priceString: '$24.99',
          pricePerMonthString: '$2.08',
        }),
      ],
    },
  },
} as unknown as Offerings;

const fixtures: Record<string, { step: SheetStep; door?: SheetDoor; guest?: boolean }> = {
  choose: { step: 'choose' },
  buying: { step: 'buying' },
  failed: { step: 'failed' },
  waiting: { step: 'waiting' },
  bought: { step: 'bought' },
  'bought-ad': { step: 'bought', door: 'ad' },
  'bought-guest': { step: 'bought', guest: true },
  empty: { step: 'empty' },
};

/** `?fixture=premium-sheet-<state>`: the sheet open in that state, never reaching the store. */
export function premiumSheetFixture(value?: string) {
  const fixture = value?.startsWith('premium-sheet-') && fixtures[value.slice(14)];
  if (!__DEV__ || !fixture) return null;
  return {
    door: 'settings' as SheetDoor,
    guest: false,
    ...fixture,
    offerings: fixture.step === 'empty' ? null : fixtureOfferings,
    until: '2027-11-11T12:00:00Z',
  };
}

export type PremiumSheetFixture = NonNullable<ReturnType<typeof premiumSheetFixture>>;
