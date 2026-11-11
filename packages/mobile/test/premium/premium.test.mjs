import { expect, mock, test } from 'bun:test';

// Module mocks would leak into other suites; run in a child like purchases.test.mjs.
test('premium is the server answer: once per identity, quiet when unavailable, one restore toast', async () => {
  if (!process.env.PREMIUM_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, PREMIUM_CHILD: '1' },
    });
    expect(child.stderr.toString()).not.toContain('(fail)');
    expect(child.exitCode).toBe(0);
    return;
  }
  globalThis.__DEV__ = false;
  let state = { user: null };
  const store = {
    getState: () => state,
    setState: (patch) => void (state = { ...state, ...patch }),
  };
  const signIn = (id, fields = {}) => store.setState({ user: { id, username: id, ...fields } });
  const calls = [];
  const answers = [];
  let restore = { ok: true };
  let bought = 'purchased';
  let available = true;
  const logs = [];
  console.log = (...args) => logs.push(['log', ...args]);
  console.warn = (...args) => logs.push(['warn', ...args]);
  mock.module('../../src/stores/auth.ts', () => ({ authStore: store, useAuthStore: () => null }));
  mock.module('../../src/api/premium.ts', () => ({
    premiumApi: {
      refresh: async () => {
        calls.push(['refresh', state.user?.id]);
        const answer = answers.shift();
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  }));
  mock.module('../../src/features/premium/purchases.ts', () => ({
    purchasesAvailable: () => available,
    restorePurchases: async () => {
      calls.push(['restore']);
      return restore;
    },
    purchase: async (pkg) => {
      calls.push(['purchase', pkg]);
      if (bought instanceof Error) throw bought;
      return bought;
    },
  }));
  const httpError = (status) =>
    Object.assign(new Error(`HTTP ${status}`), { response: { status } });
  const until = { premium: true, premium_until: '2027-03-12T12:00:00Z', premium_source: 'store' };
  const none = { premium: false, premium_until: null, premium_source: null };
  const {
    buyPremium,
    premiumInSettings,
    premiumStatus,
    refreshForIdentity,
    refreshPremium,
    restorePremium,
  } = await import('../../src/features/premium/premium.ts');

  // premiumStatus: an older server sends nothing, which is no Premium.
  expect(premiumStatus(null)).toEqual({ premium: false, until: null, source: null });
  expect(premiumStatus({ id: 'a', username: 'a' })).toEqual({
    premium: false,
    until: null,
    source: null,
  });
  expect(premiumStatus({ id: 'a', username: 'a', ...until })).toEqual({
    premium: true,
    until: new Date(Date.UTC(2027, 2, 12, 12)),
    source: 'store',
  });
  expect(
    premiumStatus({ id: 'a', ...until, premium_until: null, premium_source: 'promotional' })
  ).toEqual({ premium: true, until: null, source: 'promotional' });

  // Settings: the panel only with Premium, a Restore link without, nothing before the server says.
  expect(premiumInSettings({ id: 'a', ...none })).toBe('restore');
  expect(premiumInSettings(null)).toBe(null);
  expect(premiumInSettings({ id: 'a', username: 'a' })).toBe(null);
  expect(premiumInSettings({ id: 'a', ...until })).toBe('panel');
  expect(
    premiumInSettings({
      id: 'a',
      premium: true,
      premium_until: null,
      premium_source: 'promotional',
    })
  ).toBe('panel');

  // A sign-in identifies twice (effects can re-run) but refreshes once, and writes the answer.
  signIn('astrid');
  answers.push(until);
  await refreshForIdentity('astrid');
  await refreshForIdentity('astrid');
  expect(calls).toEqual([['refresh', 'astrid']]);
  expect(state.user).toMatchObject({ id: 'astrid', ...until });

  // A new identity refreshes once more; a server without PID-125 (404) or without
  // RevenueCat (503) is logged, never thrown, and the user stays as the server last said.
  signIn('bertil', none);
  answers.push(httpError(404));
  await refreshForIdentity('bertil');
  store.setState({ user: null });
  await refreshForIdentity(null);
  signIn('bertil', none);
  answers.push(httpError(503));
  await expect(refreshForIdentity('bertil')).resolves.toBeUndefined();
  expect(calls.slice(1)).toEqual([
    ['refresh', 'bertil'],
    ['refresh', 'bertil'],
  ]);
  expect(state.user).toMatchObject({ id: 'bertil', ...none });
  expect(logs.map(([level, , status]) => [level, status])).toEqual([
    ['log', 404],
    ['log', 503],
  ]);

  // An identify that lands after a sign-out neither refreshes nor blocks the next sign-in.
  calls.length = 0;
  store.setState({ user: null });
  await refreshForIdentity(null);
  await refreshForIdentity('cecilia');
  expect(calls).toEqual([]);
  signIn('cecilia');
  answers.push(none);
  await refreshForIdentity('cecilia');
  expect(calls).toEqual([['refresh', 'cecilia']]);

  // A late answer for a player who signed out meanwhile is not written to the next one.
  calls.length = 0;
  signIn('dag', none);
  let release;
  answers.push(new Promise((resolve) => (release = resolve)));
  const pending = refreshForIdentity('dag');
  signIn('eva', none);
  release(until);
  await pending;
  expect(state.user).toEqual({ id: 'eva', username: 'eva', ...none });

  // Two questions for one player answered out of order: the newer answer stands.
  let releaseOlder;
  answers.push(new Promise((resolve) => (releaseOlder = resolve)), until);
  const older = refreshPremium();
  await refreshPremium();
  releaseOlder(none);
  await older;
  expect(state.user).toMatchObject({ id: 'eva', ...until });

  // Web, Expo Go or no key: no store identity, so nothing to ask, and nothing remembered.
  calls.length = 0;
  available = false;
  signIn('gustav', none);
  await refreshForIdentity('gustav');
  expect(calls).toEqual([]);
  available = true;
  answers.push(none);
  await refreshForIdentity('gustav');
  expect(calls).toEqual([['refresh', 'gustav']]);

  // Restore: the store, then the server, then one answer for the toast.
  calls.length = 0;
  signIn('frida', none);
  answers.push(until);
  expect(await restorePremium()).toBe('restored');
  answers.push(none);
  signIn('frida', none);
  expect(await restorePremium()).toBe('notFound');
  // The server could not look (503, rate limited): not "restored", not "no Premium found".
  signIn('frida', until);
  answers.push(httpError(503));
  expect(await restorePremium()).toBe('failed');
  signIn('frida', none);
  answers.push(httpError(429));
  expect(await restorePremium()).toBe('failed');
  // The store did not finish: no refresh, and not "no Premium found".
  restore = { ok: false, reason: 'network' };
  expect(await restorePremium()).toBe('failed');
  expect(calls).toEqual([
    ['restore'],
    ['refresh', 'frida'],
    ['restore'],
    ['refresh', 'frida'],
    ['restore'],
    ['refresh', 'frida'],
    ['restore'],
    ['refresh', 'frida'],
    ['restore'],
  ]);

  // Subscribe: the store, then the server. Premium only once the server says so.
  calls.length = 0;
  restore = { ok: true };
  signIn('greta', none);
  answers.push(until);
  expect(await buyPremium('yearly')).toBe('bought');
  expect(state.user).toMatchObject({ id: 'greta', ...until });
  // The store took it, the server has not heard yet (webhook not in): waiting, still none.
  signIn('greta', none);
  answers.push(none);
  expect(await buyPremium('yearly')).toBe('waiting');
  // The server could not look at all: the purchase stands, so waiting, not failed.
  answers.push(httpError(503));
  expect(await buyPremium('monthly')).toBe('waiting');
  expect(state.user).toMatchObject({ id: 'greta', ...none });
  expect(calls).toEqual([
    ['purchase', 'yearly'],
    ['refresh', 'greta'],
    ['purchase', 'yearly'],
    ['refresh', 'greta'],
    ['purchase', 'monthly'],
    ['refresh', 'greta'],
  ]);
  // Ask to Buy: the store holds the payment; nothing to ask the server yet.
  calls.length = 0;
  bought = 'pending';
  expect(await buyPremium('yearly')).toBe('waiting');
  // Cancelled in the store's dialog is an answer; any other failure is one line.
  bought = 'cancelled';
  expect(await buyPremium('yearly')).toBe('cancelled');
  bought = Object.assign(new Error('store problem'), { code: '2' });
  expect(await buyPremium('yearly')).toBe('failed');
  expect(calls).toEqual([
    ['purchase', 'yearly'],
    ['purchase', 'yearly'],
    ['purchase', 'yearly'],
  ]);
  expect(state.user).toMatchObject({ id: 'greta', ...none });
});
