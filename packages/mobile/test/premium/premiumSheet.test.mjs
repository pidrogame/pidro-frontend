import { describe, expect, it } from 'bun:test';
import {
  canBuyPremium,
  doneKey,
  premiumPlans,
  premiumSheetFixture,
  sheetAfter,
} from '../../src/features/premium/premiumSheet.ts';

const pkg = (packageType, product) => ({
  identifier: `$rc_${packageType.toLowerCase()}`,
  packageType,
  product: { currencyCode: 'USD', pricePerMonthString: null, ...product },
});
const annual = pkg('ANNUAL', { price: 24.99, priceString: '$24.99' });
const monthly = pkg('MONTHLY', { price: 4.99, priceString: '$4.99' });
const lifetime = pkg('LIFETIME', { price: 119.99, priceString: '$119.99' });
const offering = (...availablePackages) => ({ availablePackages });

describe('the plans the sheet sells', () => {
  it('reads pidro_premium, yearly then monthly, and ignores any other package', () => {
    const plans = premiumPlans(
      { current: offering(monthly), all: { pidro_premium: offering(lifetime, monthly, annual) } },
      'en'
    );
    expect(plans.map((plan) => [plan.id, plan.price, plan.pkg])).toEqual([
      ['yearly', '$24.99', annual],
      ['monthly', '$4.99', monthly],
    ]);
  });

  it('falls back to the current offering, and to nothing without one', () => {
    expect(premiumPlans({ current: offering(monthly), all: {} }, 'en').map((p) => p.id)).toEqual([
      'monthly',
    ]);
    expect(premiumPlans({ current: null, all: {} }, 'en')).toEqual([]);
    expect(premiumPlans(null, 'en')).toEqual([]);
    expect(premiumPlans({ current: offering(lifetime), all: {} }, 'en')).toEqual([]);
  });

  it("notes the yearly price a month: the store's own string, else the price ÷ 12 in its currency", () => {
    const store = pkg('ANNUAL', {
      price: 29.99,
      priceString: '$29.99',
      pricePerMonthString: '$2.49',
    });
    const [fromStore] = premiumPlans({ current: offering(store), all: {} }, 'en');
    expect(fromStore.perMonth).toBe('$2.49');
    // 24.99 / 12 = 2.0825: two places, the dollar, not the app's currency.
    const [divided, month] = premiumPlans({ current: offering(annual, monthly), all: {} }, 'en');
    expect(divided.perMonth).toBe('$2.08');
    expect(month.perMonth).toBeNull();
    const kronor = pkg('ANNUAL', { price: 249, priceString: '249,00 kr', currencyCode: 'SEK' });
    const [sv] = premiumPlans({ current: offering(kronor), all: {} }, 'sv');
    expect(sv.perMonth?.replace(/\s/g, ' ')).toBe('20,75 kr');
    // An engine that cannot format the currency loses the note, never the plan.
    const odd = pkg('ANNUAL', { price: 24.99, priceString: '24.99', currencyCode: 'not a code' });
    expect(premiumPlans({ current: offering(odd), all: {} }, 'en')).toMatchObject([
      { id: 'yearly', price: '24.99', perMonth: null },
    ]);
  });
});

describe('what the sheet shows after an answer', () => {
  it('buying: Premium, waiting, back to choosing, or the failure line', () => {
    expect(sheetAfter('buy', 'bought')).toEqual({ step: 'bought', notice: null });
    expect(sheetAfter('buy', 'waiting')).toEqual({ step: 'waiting', notice: null });
    // Cancelled in the store's own dialog: nothing said.
    expect(sheetAfter('buy', 'cancelled')).toEqual({ step: 'choose', notice: null });
    expect(sheetAfter('buy', 'failed')).toEqual({ step: 'failed', notice: null });
  });

  it("restoring: Premium, or Restore's own line over the plans", () => {
    expect(sheetAfter('restore', 'restored')).toEqual({ step: 'bought', notice: null });
    expect(sheetAfter('restore', 'notFound')).toEqual({ step: 'choose', notice: 'notFound' });
    expect(sheetAfter('restore', 'failed')).toEqual({ step: 'choose', notice: 'restoreFailed' });
  });

  it('done deals the cards when the player came from the ad ticket', () => {
    expect(doneKey('ad')).toBe('premium.sheet.deal');
    expect(doneKey('settings')).toBe('premium.sheet.done');
  });
});

describe('the doors', () => {
  it('open only for a player the server says has no Premium, in a build that can sell it', () => {
    const none = { premium: false };
    expect(canBuyPremium(none, true)).toBe(true);
    // Web and builds without a RevenueCat key: nothing changes from today.
    expect(canBuyPremium(none, false)).toBe(false);
    expect(canBuyPremium({ premium: true }, true)).toBe(false);
    // An older server says nothing: no door.
    expect(canBuyPremium({}, true)).toBe(false);
    expect(canBuyPremium(null, true)).toBe(false);
  });
});

describe('fixtures', () => {
  it('only premium-sheet-<state>, with made-up packages that include one to ignore', () => {
    globalThis.__DEV__ = true;
    const choose = premiumSheetFixture('premium-sheet-choose');
    expect(choose).toMatchObject({ step: 'choose', door: 'settings' });
    expect(premiumPlans(choose.offerings, 'en').map((plan) => plan.id)).toEqual([
      'yearly',
      'monthly',
    ]);
    expect(choose.offerings.all.pidro_premium.availablePackages).toHaveLength(3);
    expect(premiumSheetFixture('premium-sheet-bought-ad')).toMatchObject({
      step: 'bought',
      door: 'ad',
    });
    expect(premiumPlans(premiumSheetFixture('premium-sheet-empty').offerings, 'en')).toEqual([]);
    expect(premiumSheetFixture('premium-sheet-nope')).toBeNull();
    expect(premiumSheetFixture('premium-none')).toBeNull();
    globalThis.__DEV__ = false;
    expect(premiumSheetFixture('premium-sheet-choose')).toBeNull();
  });
});
