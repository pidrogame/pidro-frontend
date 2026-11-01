import { afterEach, describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { createPendingInviteStore } from '../../../shared/src/stores/pendingInvite.ts';
import { redirectSystemPath } from '../../app/+native-intent.tsx';
import {
  authenticatedDestination,
  canAccessProtectedRoutes,
  entryDestination,
  initialRoute,
  joinRedirectDestination,
} from '../../src/navigation/initialRoute.ts';

globalThis.__DEV__ = true;

const require = createRequire(import.meta.url);
const configPath = require.resolve('../../app.config.js');
const baseConfig = {
  name: 'Pidro',
  scheme: 'pidro-mobile',
  ios: { bundleIdentifier: 'com.oneapps.pidro' },
  android: { package: 'com.oneapps.pidro' },
};

afterEach(() => {
  delete process.env.APP_VARIANT;
  delete process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN;
  delete require.cache[configPath];
});

describe('native invite intent', () => {
  it('rewrites supported links to the join route', () => {
    expect(redirectSystemPath({ path: 'https://www.pidro.online/j/7kq4-m2xb?s=im' })).toBe(
      '/join/7KQ4M2XB?source=im'
    );
    expect(redirectSystemPath({ path: 'pidro-mobile-dev://j/7KQ4M2XB' })).toBe('/join/7KQ4M2XB');
  });

  it('returns a safe local fallback for malformed or unrelated paths', () => {
    expect(redirectSystemPath({ path: 'https://evil.example/j/7KQ4M2XB' })).toBe('/+not-found');
    expect(redirectSystemPath({ path: 'pidro-mobile://j/%37KQ4M2XB' })).toBe('/+not-found');
  });

  it("opens a player's own link on the play route", () => {
    expect(redirectSystemPath({ path: 'https://pidro.online/play/Bertil' })).toBe('/play/bertil');
    expect(redirectSystemPath({ path: 'pidro-mobile://play/bertil' })).toBe('/play/bertil');
    expect(redirectSystemPath({ path: 'https://pidro.online/play/b' })).toBe('/+not-found');
  });

  it('opens dev harness routes from simulator deep links', () => {
    expect(redirectSystemPath({ path: 'exp://127.0.0.1:8081/--/table-dev?phase=bidding' })).toBe(
      '/table-dev?phase=bidding'
    );
    expect(redirectSystemPath({ path: 'exp://127.0.0.1:8081/--/ui-dev?state=components' })).toBe(
      '/ui-dev?state=components'
    );
    expect(redirectSystemPath({ path: 'pidro-mobile-dev://auth-flow-dev' })).toBe('/auth-flow-dev');
    expect(redirectSystemPath({ path: '/table-dev?phase=game_over' })).toBe(
      '/table-dev?phase=game_over'
    );
  });

  it('opens account fixture states from simulator deep links', () => {
    expect(
      redirectSystemPath({ path: 'exp://127.0.0.1:8081/--/classic-forgot?fixture=sent' })
    ).toBe('/classic-forgot?fixture=sent');
    expect(redirectSystemPath({ path: 'exp://127.0.0.1:8081/--/register?fixture=name' })).toBe(
      '/register?fixture=name'
    );

    globalThis.__DEV__ = false;
    try {
      expect(redirectSystemPath({ path: 'exp://127.0.0.1:8081/--/classic-forgot' })).toBe(
        '/+not-found'
      );
    } finally {
      globalThis.__DEV__ = true;
    }
  });

  it('never lets an outside origin or a release build reach a harness route', () => {
    expect(redirectSystemPath({ path: 'https://evil.example/--/table-dev' })).toBe('/+not-found');
    expect(redirectSystemPath({ path: 'exp://127.0.0.1:8081/--/settings' })).toBe('/+not-found');

    globalThis.__DEV__ = false;
    try {
      expect(redirectSystemPath({ path: 'exp://127.0.0.1:8081/--/table-dev?phase=bidding' })).toBe(
        '/+not-found'
      );
    } finally {
      globalThis.__DEV__ = true;
    }
  });

  it('preserves ordinary app and development-client startup paths', () => {
    expect(redirectSystemPath({ path: '/' })).toBe('/');
    expect(redirectSystemPath({ path: 'pidro-mobile://' })).toBe('/');
    expect(redirectSystemPath({ path: 'pidro-mobile-dev:///' })).toBe('/');
    expect(
      redirectSystemPath({
        path: 'exp+pidro-mobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081',
      })
    ).toBe('/');
  });

  // Every shipped variant launches with its own scheme. A scheme missing from
  // the startup or invite lists sends a plain launch to +not-found (the 3.1/3.2
  // Beta did exactly that), so check all variants from app.config.js.
  it.each(['production', 'development', 'beta'])(
    'starts the %s variant normally and accepts its invite and player links',
    (variant) => {
      process.env.APP_VARIANT = variant;
      delete require.cache[configPath];
      const { scheme } = require(configPath)({ config: baseConfig });

      expect(redirectSystemPath({ path: `${scheme}://` })).toBe('/');
      expect(redirectSystemPath({ path: `${scheme}://j/7KQ4M2XB` })).toBe('/join/7KQ4M2XB');
      expect(redirectSystemPath({ path: `${scheme}://play/bertil` })).toBe('/play/bertil');
    }
  );
});

describe('initial route', () => {
  const answeredUser = {
    id: 'user-1',
    username: 'player',
    email: null,
    age_band: '18_plus',
  };

  it('waits for all persisted stores and gives an authenticated invite precedence', () => {
    expect(initialRoute(false, true, true, 'unauthenticated', null, null, null)).toBeNull();
    expect(initialRoute(true, false, true, 'unauthenticated', null, null, null)).toBeNull();
    expect(initialRoute(true, true, false, 'unauthenticated', null, null, null)).toBeNull();
    expect(
      initialRoute(
        true,
        true,
        true,
        'authenticated',
        { code: '7KQ4M2XB', source: 'im', receivedAt: 1 },
        '18_plus',
        answeredUser
      )
    ).toBe('/join/7KQ4M2XB?source=im');
  });

  it('gates no answer, under-13 answers, and signed-in unknown users', () => {
    expect(entryDestination('unauthenticated', null, null, null)).toBe('/age');
    expect(entryDestination('unauthenticated', null, 'under_13', null)).toBe('/age');
    expect(
      entryDestination('authenticated', null, '18_plus', {
        ...answeredUser,
        age_band: 'unknown',
      })
    ).toBe('/age');
    expect(
      entryDestination('authenticated', null, '13_17', {
        id: 'legacy-user',
        username: 'legacy',
        email: null,
      })
    ).toBe('/age');
  });

  it('resumes Welcome or the pending authenticated invite after an eligible answer', () => {
    const invite = { code: '7KQ4M2XB', source: 'im', receivedAt: 1 };
    expect(entryDestination('unauthenticated', null, '18_plus', null)).toBe('/welcome');
    expect(entryDestination('unauthenticated', invite, '18_plus', null)).toBe('/welcome');
    expect(entryDestination('authenticated', null, '18_plus', answeredUser)).toBe('/home');
    expect(entryDestination('authenticated', invite, '18_plus', answeredUser)).toBe(
      '/join/7KQ4M2XB?source=im'
    );
  });

  it('uses one post-authentication return contract for home and invitations', () => {
    expect(authenticatedDestination(null)).toBe('/home');
    expect(authenticatedDestination({ code: '7KQ4M2XB', source: 'im', receivedAt: 1 })).toBe(
      '/join/7KQ4M2XB?source=im'
    );
    expect(authenticatedDestination({ code: '7KQ4M2XB', receivedAt: 1 })).toBe('/join/7KQ4M2XB');
  });

  it('stores an invite only when the join route must redirect away', () => {
    expect(joinRedirectDestination(null, answeredUser)).toBe('/age');
    expect(joinRedirectDestination('18_plus', null)).toBe('/welcome');
    expect(joinRedirectDestination('18_plus', answeredUser)).toBeNull();
  });

  it('removes protected-route access when an active session is cleared', () => {
    expect(canAccessProtectedRoutes(false, true, 'authenticated', '18_plus', answeredUser)).toBe(
      false
    );
    expect(canAccessProtectedRoutes(true, false, 'authenticated', '18_plus', answeredUser)).toBe(
      false
    );
    expect(canAccessProtectedRoutes(true, true, 'checking', '18_plus', answeredUser)).toBe(false);
    expect(canAccessProtectedRoutes(true, true, 'authenticated', '18_plus', answeredUser)).toBe(
      true
    );
    expect(
      canAccessProtectedRoutes(true, true, 'authenticated', '18_plus', {
        ...answeredUser,
        age_band: 'unknown',
      })
    ).toBe(false);
    expect(canAccessProtectedRoutes(true, true, 'unauthenticated', '18_plus', answeredUser)).toBe(
      false
    );
  });

  it('settles startup routing when pending-invite storage cannot be read', async () => {
    const store = createPendingInviteStore({
      storage: {
        getItem: async () => {
          throw new Error('storage unavailable');
        },
        setItem: async () => {},
        removeItem: async () => {},
      },
      storageKey: 'rejecting-pending-invite-test',
    });

    await store.persist.rehydrate();

    expect(store.getState().hydrated).toBe(true);
    expect(
      initialRoute(true, store.getState().hydrated, true, 'unauthenticated', null, '18_plus', null)
    ).toBe('/welcome');
  });
});

describe('resolved variant configuration', () => {
  it.each([
    ['production', 'Pidro', 'pidro-mobile', 'com.oneapps.pidro', true],
    ['development', 'Pidro Dev', 'pidro-mobile-dev', 'com.marcelfahle.pidro3.dev', false],
    ['beta', 'Pidro Beta', 'pidro-mobile-beta', 'com.oneapps.pidro.beta', true],
  ])(
    'keeps %s identifiers and intended links',
    (variant, name, scheme, identifier, verifiedAndroid) => {
      process.env.APP_VARIANT = variant;
      delete require.cache[configPath];
      const configure = require(configPath);
      const config = configure({ config: baseConfig });

      expect(config.name).toBe(name);
      expect(config.scheme).toBe(scheme);
      expect(config.ios.bundleIdentifier).toBe(identifier);
      expect(config.ios.associatedDomains).toEqual([
        'applinks:www.pidro.online',
        'applinks:pidro.online',
      ]);
      expect(config.android.package).toBe(identifier);
      expect(config.android.allowBackup).toBe(false);
      expect(config.ios.usesAppleSignIn).toBe(true);
      expect(config.plugins).toContain('expo-apple-authentication');
      expect(
        config.plugins.some(
          (plugin) => Array.isArray(plugin) && plugin[0] === 'react-native-fbsdk-next'
        )
      ).toBe(true);
      if (verifiedAndroid) {
        expect(config.android.blockedPermissions).toEqual([
          'android.permission.READ_EXTERNAL_STORAGE',
          'android.permission.SYSTEM_ALERT_WINDOW',
          'android.permission.WRITE_EXTERNAL_STORAGE',
        ]);
        expect(config.android.intentFilters).toEqual([
          {
            action: 'VIEW',
            autoVerify: true,
            data: [{ scheme: 'https', host: 'www.pidro.online', pathPrefix: '/j/' }],
            category: ['BROWSABLE', 'DEFAULT'],
          },
          {
            action: 'VIEW',
            autoVerify: true,
            data: [{ scheme: 'https', host: 'pidro.online', pathPrefix: '/j/' }],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]);
      } else {
        expect(config.android.blockedPermissions).toEqual([]);
        expect(config.android.intentFilters).toEqual([]);
      }
    }
  );

  it('defaults to the Beta identity until the public launch', () => {
    delete process.env.APP_VARIANT;
    delete require.cache[configPath];
    const configure = require(configPath);
    const config = configure({ config: baseConfig });

    expect(config.name).toBe('Pidro Beta');
    expect(config.ios.bundleIdentifier).toBe('com.oneapps.pidro.beta');
    expect(config.android.package).toBe('com.oneapps.pidro.beta');
    expect(config.ios.usesAppleSignIn).toBe(true);
  });

  it('always configures the Facebook SDK and adds the client token only when supplied', () => {
    process.env.APP_VARIANT = 'beta';
    delete process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN;
    delete require.cache[configPath];
    const withoutToken = require(configPath)({ config: baseConfig });
    const facebook = withoutToken.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'react-native-fbsdk-next'
    );
    expect(facebook[1]).toMatchObject({ appID: '345200965110578', autoLogAppEventsEnabled: false });
    expect(facebook[1]).not.toHaveProperty('clientToken');

    process.env.APP_VARIANT = 'beta';
    process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN = 'configured-client-token';
    delete require.cache[configPath];
    const configure = require(configPath);
    const config = configure({ config: baseConfig });

    expect(config.plugins).toContainEqual([
      'react-native-fbsdk-next',
      {
        appID: '345200965110578',
        clientToken: 'configured-client-token',
        displayName: 'Pidro',
        scheme: 'fb345200965110578',
        advertiserIDCollectionEnabled: false,
        autoLogAppEventsEnabled: false,
        isAutoInitEnabled: false,
        iosUserTrackingPermission: false,
      },
    ]);
  });

  it.each(['prod', ''])('rejects an unsupported %j variant', (variant) => {
    process.env.APP_VARIANT = variant;
    delete require.cache[configPath];
    const configure = require(configPath);

    expect(() => configure({ config: baseConfig })).toThrow('Unsupported APP_VARIANT');
  });
});
