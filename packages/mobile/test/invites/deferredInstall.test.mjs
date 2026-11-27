import { describe, expect, it } from 'bun:test';
import {
  DEFERRED_ATTEMPT_KEY,
  parsePlayInstallReferrer,
  resolveDeferredInstall,
} from '../../src/features/invites/deferredInstall.ts';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => values.set(key, value),
    values,
  };
}

function dependencies(overrides = {}) {
  const calls = [];
  const storage = memoryStorage();
  const deps = {
    platform: 'ios',
    storage,
    now: () => Date.parse('2026-09-03T12:00:00Z'),
    getInstallationTime: async () => new Date('2026-09-03T11:50:00Z'),
    getPlayReferrer: async () => {
      calls.push('referrer');
      return null;
    },
    getFingerprint: async () => ({
      os_major: '18',
      screen_class: 'compact',
      locale: 'en-US',
      timezone: 'Europe/Madrid',
    }),
    getInstallId: async () => 'install-1',
    resolve: async (request) => {
      calls.push({ request });
      return { code: '7KQ4M2XB', friend: null };
    },
    ...overrides,
  };
  return { calls, deps, storage };
}

const bertil = { slug: 'bertil', display_name: 'Bertil', avatar_url: null };

describe('Play Install Referrer parsing', () => {
  it('accepts exactly one normalized invite key alongside campaign fields', () => {
    expect(parsePlayInstallReferrer('utm_source=share&invite=7kq4-m2xb')).toBe('invite=7KQ4M2XB');
  });

  it("accepts exactly one friend key: a player's own link", () => {
    expect(parsePlayInstallReferrer('utm_source=link&friend=Bertil-2')).toBe('friend=bertil-2');
    for (const value of [
      'friend=bertil&friend=bertil',
      'friend=bertil&invite=7KQ4M2XB',
      'friend=b',
      'friend=../lobby',
      'friend=-bertil',
    ]) {
      expect(parsePlayInstallReferrer(value)).toBeNull();
    }
  });

  it('rejects duplicates, malformed values, URLs, and unrelated keys', () => {
    for (const value of [
      'invite=7KQ4M2XB&invite=7KQ4M2XB',
      'invite=%ZZ',
      'invite=invalid',
      'https://www.pidro.online/j/7KQ4M2XB',
      'other=7KQ4M2XB',
    ]) {
      expect(parsePlayInstallReferrer(value)).toBeNull();
    }
  });
});

describe('deferred install orchestration', () => {
  it('marks the one-shot attempt before native work and gives a direct invite precedence', async () => {
    const { calls, deps, storage } = dependencies({
      getInstallationTime: async () => {
        throw new Error('must not run');
      },
    });

    expect(
      await resolveDeferredInstall({
        pendingInvite: { code: 'N4RT8VW2', source: 'im', receivedAt: 1 },
        ...deps,
      })
    ).toBeNull();
    expect(storage.values.get(DEFERRED_ATTEMPT_KEY)).toBe('1');
    expect(calls).toEqual([]);
  });

  it('matches a fresh iOS install without ever reading the Play referrer', async () => {
    const { calls, deps } = dependencies();

    expect(await resolveDeferredInstall({ pendingInvite: null, ...deps })).toEqual({
      code: '7KQ4M2XB',
      friend: null,
    });
    expect(calls).toEqual([
      {
        request: {
          platform: 'ios',
          install_id: 'install-1',
          os_major: '18',
          screen_class: 'compact',
          locale: 'en-US',
          timezone: 'Europe/Madrid',
        },
      },
    ]);
  });

  it('uses a strict Android referrer after the fingerprint window without coarse fields', async () => {
    const { calls, deps } = dependencies({
      platform: 'android',
      getInstallationTime: async () => new Date('2026-09-03T10:00:00Z'),
      getPlayReferrer: async () => 'utm_source=share&invite=7kq4-m2xb',
    });

    expect(await resolveDeferredInstall({ pendingInvite: null, ...deps })).toEqual({
      code: '7KQ4M2XB',
      friend: null,
    });
    expect(calls).toEqual([
      {
        request: {
          platform: 'android',
          install_id: 'install-1',
          referrer: 'invite=7KQ4M2XB',
        },
      },
    ]);
  });

  it("sends an Android friend referrer and hands back the server's friend", async () => {
    const { calls, deps } = dependencies({
      platform: 'android',
      getInstallationTime: async () => new Date('2026-09-03T10:00:00Z'),
      getPlayReferrer: async () => 'friend=bertil',
      resolve: async (request) => {
        calls.push({ request });
        return { code: null, friend: bertil };
      },
    });

    expect(await resolveDeferredInstall({ pendingInvite: null, ...deps })).toEqual({
      code: null,
      friend: bertil,
    });
    expect(calls).toEqual([
      { request: { platform: 'android', install_id: 'install-1', referrer: 'friend=bertil' } },
    ]);
  });

  it('answers with a fingerprint friend, and nothing when the server matched neither', async () => {
    const friend = dependencies({ resolve: async () => ({ code: null, friend: bertil }) });
    expect(await resolveDeferredInstall({ pendingInvite: null, ...friend.deps })).toEqual({
      code: null,
      friend: bertil,
    });

    const neither = dependencies({ resolve: async () => ({ code: null, friend: null }) });
    expect(await resolveDeferredInstall({ pendingInvite: null, ...neither.deps })).toBeNull();
  });

  it('skips old or unknown-age installs without an Android referrer', async () => {
    for (const installationTime of [new Date('2026-09-03T10:00:00Z'), null]) {
      const { calls, deps } = dependencies({
        getInstallationTime: async () => installationTime,
      });
      expect(await resolveDeferredInstall({ pendingInvite: null, ...deps })).toBeNull();
      expect(calls).toEqual([]);
    }
  });

  it('does not retry a completed, failed, or timed-out attempt', async () => {
    let aborted = false;
    const { deps, storage } = dependencies({
      timeoutMs: 10,
      resolve: (_request, signal) =>
        new Promise(() => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
        }),
    });

    expect(await resolveDeferredInstall({ pendingInvite: null, ...deps })).toBeNull();
    expect(aborted).toBe(true);
    expect(storage.values.get(DEFERRED_ATTEMPT_KEY)).toBe('1');

    expect(
      await resolveDeferredInstall({
        pendingInvite: null,
        ...deps,
        resolve: async () => ({ code: 'N4RT8VW2', friend: null }),
      })
    ).toBeNull();
  });
});
