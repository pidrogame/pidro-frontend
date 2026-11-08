import { expect, mock, test } from 'bun:test';

// Module mocks would leak into other suites; run in a child like purchases.test.mjs.
test('push never prompts, registers once per start and player, and forgets on sign-out', async () => {
  if (!process.env.PUSH_CHILD) {
    for (const os of ['android', 'web']) {
      const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
        env: { ...process.env, PUSH_CHILD: '1', PUSH_OS: os },
      });
      expect(child.stderr.toString()).not.toContain('(fail)');
      expect(child.exitCode).toBe(0);
    }
    return;
  }
  globalThis.__DEV__ = false;
  const os = process.env.PUSH_OS;
  const calls = [];
  let permission = 'undetermined';
  mock.module('react-native', () => ({
    Platform: { OS: os },
    Linking: { openURL: async () => {} },
  }));
  mock.module('expo-constants', () => ({
    default: {
      executionEnvironment: 'standalone',
      expoConfig: { extra: { eas: { projectId: 'project-1' } } },
    },
    ExecutionEnvironment: { StoreClient: 'storeClient' },
  }));
  mock.module('expo-application', () => ({ nativeBuildVersion: '14' }));
  mock.module('expo-router', () => ({ router: { push: () => {} } }));
  mock.module('expo-notifications', () => ({
    AndroidImportance: { DEFAULT: 3 },
    getPermissionsAsync: async () => ({ status: permission }),
    requestPermissionsAsync: async () => {
      calls.push(['prompt', permission]);
      return { status: permission };
    },
    setNotificationChannelAsync: async (id) => calls.push(['channel', id]),
    getExpoPushTokenAsync: async ({ projectId }) => {
      calls.push(['token', projectId]);
      return { data: 'ExponentPushToken[abc]' };
    },
  }));
  mock.module('../../src/api/push.ts', () => ({
    pushApi: {
      register: async (request) => calls.push(['register', request]),
      unregister: async (token) => calls.push(['unregister', token]),
    },
  }));
  mock.module('../../src/features/invites/installId.ts', () => ({
    getInstallId: async () => 'install-1',
  }));
  const push = await import('../../src/features/push/push.ts');

  // Not yet allowed: nothing is asked and nothing is sent.
  await push.registerPushIfGranted('astrid');
  permission = 'denied';
  await push.registerPushIfGranted('astrid');
  expect(calls).toEqual([]);

  permission = 'granted';
  await push.registerPushIfGranted('astrid');
  await push.registerPushIfGranted('astrid');
  if (os === 'web') {
    expect(await push.getPushPermission()).toBe('unavailable');
    await push.unregisterPush();
    expect(calls).toEqual([]);
    return;
  }
  const register = [
    'register',
    {
      token: 'ExponentPushToken[abc]',
      platform: 'android',
      install_id: 'install-1',
      app_version: '3.3.0',
      app_build: '14',
    },
  ];
  // Already granted, so the request returns without a dialog; once for Astrid this start.
  expect(calls.map(([name]) => name)).toEqual(['channel', 'prompt', 'token', 'register']);
  expect(calls[0]).toEqual(['channel', 'default']);
  expect(calls[1]).toEqual(['prompt', 'granted']);
  expect(calls[2]).toEqual(['token', 'project-1']);
  expect(calls[3]).toMatchObject(register);

  await push.unregisterPush();
  expect(calls.at(-1)).toEqual(['unregister', 'ExponentPushToken[abc]']);
  // Signed out with nothing registered: nothing to delete.
  await push.unregisterPush();
  expect(calls.filter(([name]) => name === 'unregister')).toHaveLength(1);

  // Bertil signs in on the same start and registers too.
  await push.registerPushIfGranted('bertil');
  expect(calls.filter(([name]) => name === 'register')).toHaveLength(2);
});
