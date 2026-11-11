/**
 * Purchases over RevenueCat (react-native-purchases). Thin and quiet: every function is a
 * no-op on web and when this build has no RevenueCat key for its platform.
 *
 * Nothing in the app reads CustomerInfo to unlock anything. The server owns `premium`.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PurchasesError, PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';

const SYNCED_KEY = 'purchases.synced.v1';
let configured = false;

function apiKey(): string | undefined {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return undefined;
  return Constants.expoConfig?.extra?.revenueCatKey?.[Platform.OS] || undefined;
}

export function purchasesAvailable(): boolean {
  return Boolean(apiKey());
}

// Required, not imported, so web and key-less builds never load the native SDK.
function sdk() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('react-native-purchases') as typeof import('react-native-purchases')).default;
}

function errorCode(error: unknown): string | undefined {
  return (error as Partial<PurchasesError> | null)?.code;
}

export function configurePurchases(): void {
  const key = apiKey();
  if (configured || !key) return;
  const Purchases = sdk();
  if (__DEV__) void Purchases.setLogLevel(Purchases.LOG_LEVEL.VERBOSE);
  // No app user id: the SDK's anonymous id until identifyPurchaser.
  Purchases.configure({ apiKey: key });
  configured = true;
}

/** Once per install: RevenueCat warns against syncing on every launch. True when it synced now. */
export async function syncPurchasesOnce(): Promise<boolean> {
  if (!configured) return false;
  try {
    if (await AsyncStorage.getItem(SYNCED_KEY)) return false;
    await sdk().syncPurchases();
    await AsyncStorage.setItem(SYNCED_KEY, '1');
    return true;
  } catch (error) {
    console.warn('[Purchases] Sync failed', error);
    return false;
  }
}

export async function identifyPurchaser(userId: string): Promise<void> {
  if (!configured) return;
  await sdk()
    .logIn(userId)
    .catch((error) => console.warn('[Purchases] Could not identify', error));
}

export async function clearPurchaser(): Promise<void> {
  if (!configured) return;
  const Purchases = sdk();
  await Purchases.logOut().catch((error) => {
    // Signing out a guest who was never identified is fine.
    if (errorCode(error) !== Purchases.PURCHASES_ERROR_CODE.LOG_OUT_ANONYMOUS_USER_ERROR)
      console.warn('[Purchases] Could not clear', error);
  });
}

export async function restorePurchases(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!configured) return { ok: false, reason: 'unavailable' };
  try {
    await sdk().restorePurchases();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: (error as Error | null)?.message ?? 'unknown' };
  }
}

/** For the Premium sheet (PID-126). Null when the store cannot answer, such as offline. */
export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (!configured) return null;
  try {
    return await sdk().getOfferings();
  } catch (error) {
    console.warn('[Purchases] No offerings', error);
    return null;
  }
}

/** Cancelling and a pending payment (Ask to Buy) are answers, not errors; other failures throw. */
export async function purchase(
  pkg: PurchasesPackage
): Promise<'purchased' | 'cancelled' | 'pending'> {
  if (!configured) throw new Error('Purchases are unavailable');
  const Purchases = sdk();
  try {
    await Purchases.purchasePackage(pkg);
    return 'purchased';
  } catch (error) {
    const code = errorCode(error);
    if (code === Purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled';
    if (code === Purchases.PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return 'pending';
    throw error;
  }
}
