import { expect, mock, test } from 'bun:test';

// Module mocks would leak into other suites; run in a child like startupUpdateHook.
test('purchases configure once, sync once per install, and stay quiet without a key', async () => {
  if (!process.env.PURCHASES_CHILD) {
    for (const key of ['appl_test', '']) {
      const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
        env: { ...process.env, PURCHASES_CHILD: '1', PURCHASES_KEY: key },
      });
      expect(child.stderr.toString()).not.toContain('(fail)');
      expect(child.exitCode).toBe(0);
    }
    return;
  }
  globalThis.__DEV__ = false;
  const key = process.env.PURCHASES_KEY;
  const storage = new Map();
  const calls = [];
  let syncFails = true;
  mock.module('react-native', () => ({ Platform: { OS: 'ios' } }));
  mock.module('expo-constants', () => ({
    default: { expoConfig: { extra: { revenueCatKey: { ios: key, android: 'goog_other' } } } },
  }));
  mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
      getItem: async (name) => storage.get(name) ?? null,
      setItem: async (name, value) => void storage.set(name, value),
    },
  }));
  mock.module('react-native-purchases', () => ({
    default: {
      LOG_LEVEL: { VERBOSE: 'VERBOSE' },
      PURCHASES_ERROR_CODE: { LOG_OUT_ANONYMOUS_USER_ERROR: '22', PURCHASE_CANCELLED_ERROR: '1' },
      logOut: async () => {
        calls.push(['logOut']);
        throw { code: '22', message: 'already anonymous' };
      },
      purchasePackage: async (pkg) => {
        calls.push(['purchase', pkg]);
        if (pkg === 'cancel') throw { code: '1', message: 'cancelled' };
        if (pkg === 'broken') throw { code: '2', message: 'store problem' };
      },
      setLogLevel: async () => {},
      configure: (options) => calls.push(['configure', options]),
      syncPurchases: async () => {
        calls.push(['sync']);
        if (syncFails) throw new Error('offline');
      },
    },
  }));
  const purchases = await import('../../src/features/premium/purchases.ts');

  purchases.configurePurchases();
  purchases.configurePurchases();
  // Three launches: the first sync fails offline, the second succeeds, the third skips.
  await purchases.syncPurchasesOnce();
  syncFails = false;
  await purchases.syncPurchasesOnce();
  await purchases.syncPurchasesOnce();

  if (key) {
    expect(purchases.purchasesAvailable()).toBe(true);
    // The iOS key, no app user id: the SDK's anonymous id until we identify.
    expect(calls.slice(0, 3)).toEqual([['configure', { apiKey: 'appl_test' }], ['sync'], ['sync']]);
    expect(storage.get('purchases.synced.v1')).toBe('1');
    // Signing out a guest who was never identified is not an error.
    await expect(purchases.clearPurchaser()).resolves.toBeUndefined();
    // Cancelling is an answer; any other store failure still throws.
    expect(await purchases.purchase('pkg')).toBe('purchased');
    expect(await purchases.purchase('cancel')).toBe('cancelled');
    await expect(purchases.purchase('broken')).rejects.toMatchObject({ code: '2' });
  } else {
    expect(purchases.purchasesAvailable()).toBe(false);
    expect(calls).toEqual([]);
    expect(storage.size).toBe(0);
    expect(await purchases.restorePurchases()).toEqual({ ok: false, reason: 'unavailable' });
    await purchases.clearPurchaser();
    expect(await purchases.getDefaultOffering()).toBeNull();
    expect(calls).toEqual([]);
  }
});
