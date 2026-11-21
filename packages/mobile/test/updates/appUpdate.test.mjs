import { describe, expect, it } from 'bun:test';
import { setLocale, t, useLobbyStore } from '@pidro/shared';
import {
  channelLabel,
  requiredStoreUpdate,
  runningUpdate,
  nativeStoreUpdate,
  updateBuildLine,
  updateStoreLabel,
} from '../../src/features/appUpdate.ts';

it('opens only the server destination below its configured native minimum', () => {
  const versions = { android: '3.2.10', ios: '3.3.0' };
  const minimum = { versions };
  const urls = {
    android: 'https://example.test/android?release=public',
    ios: 'https://example.test/ios?release=public',
  };
  const below = (platform, version, minimums = minimum, storeUrls = urls) =>
    nativeStoreUpdate(platform, { version, build: '1' }, minimums, storeUrls);
  expect(below('android', '3.2.9')).toEqual({
    id: `android:3.2.10:${urls.android}`,
    url: urls.android,
  });
  expect(below('ios', '3.2.10')?.url).toBe(urls.ios);
  expect(below('android', '3.2.10')).toBeNull();
  expect(below('android', '3.2.11')).toBeNull();
  expect(below('android', '3.10.0')).toBeNull();
  expect(below('ios', '3.3.0')).toBeNull();
  expect(below('ios', '3.2.2', { versions: { android: '3.2.10' } })).toBeNull();
  expect(below('android', '3.2.2', { versions: {} })).toBeNull();
  expect(below('web', '3.2.2')).toBeNull();
  expect(below('android', null)).toBeNull();
  expect(below('android', '3.2.2', { versions: { android: 'not-a-version' } })).toBeNull();
  expect(below('android', '3.2.2', minimum, {})).toBeNull();
  expect(below('android', '3.2.2', minimum, { ios: urls.ios })).toBeNull();
  expect(below('android', '3.2.2', minimum, { android: '' })).toBeNull();
});

it('on the minimum version, a build below the minimum build gets the nudge', () => {
  const minimums = {
    versions: { ios: '3.3.0', android: '3.3.0' },
    builds: { ios: '15', android: '12' },
  };
  const urls = { ios: 'https://example.test/ios', android: 'https://example.test/android' };
  const nudge = (platform, version, build, policy = minimums) =>
    nativeStoreUpdate(platform, { version, build }, policy, urls)?.url ?? null;
  expect(nudge('ios', '3.3.0', '14')).toBe(urls.ios);
  expect(nudge('android', '3.3.0', '11')).toBe(urls.android);
  expect(nudge('ios', '3.3.0', '15')).toBeNull();
  expect(nudge('android', '3.3.0', '12')).toBeNull();
  // Numbers, not text: build 9 is below 15, build 100 is not.
  expect(nudge('ios', '3.3.0', '9')).toBe(urls.ios);
  expect(nudge('ios', '3.3.0', '100')).toBeNull();
  // Each platform counts its own builds: Android 13 is new, iOS 13 is old.
  expect(nudge('android', '3.3.0', '13')).toBeNull();
  expect(nudge('ios', '3.3.0', '13')).toBe(urls.ios);
  // The version decides first, whatever the build.
  expect(nudge('ios', '3.2.9', '99')).toBe(urls.ios);
  expect(nudge('ios', '3.3.1', '1')).toBeNull();
  // No build from the server, or none known here: the version alone decides.
  expect(nudge('ios', '3.3.0', '14', { versions: minimums.versions })).toBeNull();
  expect(nudge('ios', '3.3.0', '14', { ...minimums, builds: { android: '12' } })).toBeNull();
  expect(nudge('ios', '3.2.9', '14', { versions: minimums.versions })).toBe(urls.ios);
  expect(nudge('ios', '3.3.0', null)).toBeNull();
  expect(nudge('ios', '3.3.0', '14', { ...minimums, builds: { ios: 'soon' } })).toBeNull();
});

describe('the required update (PID-500)', () => {
  const urls = { ios: 'https://example.test/testflight', android: 'https://example.test/play' };
  const stop = (
    platform,
    version,
    build,
    required,
    { pathname = '/home', storeUrls = urls } = {}
  ) => requiredStoreUpdate(platform, { version, build }, required, storeUrls, pathname);

  it('stops a version below the required one, by numbers, not text', () => {
    const required = { ios: { version: '3.10.0', build: null }, android: null };
    expect(stop('ios', '3.9.9', '99', required)).toBe(urls.ios);
    expect(stop('ios', '3.4.0', '1', required)).toBe(urls.ios);
    expect(stop('ios', '3.10.0', '1', required)).toBeNull();
    expect(stop('ios', '3.11.0', '1', required)).toBeNull();
    expect(stop('ios', '4.0.0', '1', required)).toBeNull();
  });

  it('on the required version, stops a build below a required build', () => {
    const required = {
      ios: { version: '3.4.0', build: '60' },
      android: { version: '3.4.0', build: 12 },
    };
    expect(stop('ios', '3.4.0', '59', required)).toBe(urls.ios);
    expect(stop('ios', '3.4.0', '9', required)).toBe(urls.ios);
    expect(stop('ios', '3.4.0', '60', required)).toBeNull();
    expect(stop('ios', '3.4.0', '100', required)).toBeNull();
    // The version decides first; a build from the server may come as a number.
    expect(stop('ios', '3.4.1', '1', required)).toBeNull();
    expect(stop('android', '3.4.0', '11', required)).toBe(urls.android);
    expect(stop('android', '3.4.0', '12', required)).toBeNull();
    // Without a required build, the same version is enough.
    expect(stop('ios', '3.4.0', '1', { ios: { version: '3.4.0', build: null } })).toBeNull();
  });

  it('null is off, per platform', () => {
    const iosOnly = { ios: { version: '9.0.0', build: null }, android: null };
    expect(stop('android', '1.0.0', '1', iosOnly)).toBeNull();
    expect(stop('ios', '1.0.0', '1', { ios: { version: null, build: '99' } })).toBeNull();
    expect(stop('ios', '1.0.0', '1', { ios: null, android: null })).toBeNull();
    expect(stop('web', '1.0.0', '1', iosOnly)).toBeNull();
  });

  it('never blocks without an answer from the server or a store to send the player to', () => {
    // A lobby join that failed (offline, server down) leaves the store as it starts.
    expect(stop('ios', '1.0.0', '1', useLobbyStore.getState().updateRequired)).toBeNull();
    // A server without the field, or one that sends null.
    expect(stop('ios', '1.0.0', '1', undefined)).toBeNull();
    expect(stop('ios', '1.0.0', '1', null)).toBeNull();
    const required = { ios: { version: '9.0.0', build: null } };
    expect(stop('ios', '1.0.0', '1', required, { storeUrls: {} })).toBeNull();
    expect(stop('ios', null, null, required)).toBeNull();
  });

  it('waits while the player is at a table', () => {
    const required = { ios: { version: '9.0.0', build: null } };
    expect(stop('ios', '1.0.0', '1', required, { pathname: '/game/7KQ4M2XB' })).toBeNull();
    // Back out of the table, in the lobby or at Home, it stops them.
    expect(stop('ios', '1.0.0', '1', required, { pathname: '/lobby' })).toBe(urls.ios);
    expect(stop('ios', '1.0.0', '1', required, { pathname: '/home' })).toBe(urls.ios);
  });

  it('says it in English and Swedish', () => {
    expect(t('update.requiredTitle')).toBe('Time to update');
    setLocale('sv');
    try {
      expect(t('update.requiredTitle')).toBe('Dags att uppdatera');
      expect(t('update.requiredAction')).toBe('Uppdatera');
    } finally {
      setLocale('en');
    }
  });
});

describe('the update card', () => {
  it('sends beta iPhones to TestFlight and everyone else to their store', () => {
    expect(updateStoreLabel('ios', 'beta')).toBe('Update in TestFlight');
    expect(updateStoreLabel('ios', 'production')).toBe('Update in App Store');
    expect(updateStoreLabel('ios', undefined)).toBe('Update in App Store');
    expect(updateStoreLabel('android', 'beta')).toBe('Update in Google Play');
    expect(updateStoreLabel('android', 'production')).toBe('Update in Google Play');
    expect(updateStoreLabel('web', 'beta')).toBeNull();
  });

  it('names both builds only when the installed one is below', () => {
    expect(updateBuildLine('14', '19')).toBe('You have build 14 · this is build 19');
    // Numbers, not text: 9 is below 10.
    expect(updateBuildLine('9', '10')).toBe('You have build 9 · this is build 10');
    expect(updateBuildLine('19', '19')).toBeNull();
    expect(updateBuildLine('20', '19')).toBeNull();
    expect(updateBuildLine('100', '19')).toBeNull();
    expect(updateBuildLine(null, '19')).toBeNull();
    expect(updateBuildLine('14', undefined)).toBeNull();
    expect(updateBuildLine('14', 'soon')).toBeNull();
    expect(updateBuildLine('14b', '19')).toBeNull();
    expect(updateBuildLine('', '19')).toBeNull();
  });

  it('speaks Swedish with the word Settings uses', () => {
    setLocale('sv');
    try {
      expect(updateStoreLabel('ios', 'beta')).toBe('Uppdatera i TestFlight');
      expect(updateBuildLine('14', '19')).toBe('Du har byggnummer 14 · det här är byggnummer 19');
    } finally {
      setLocale('en');
    }
  });
});

describe('what Settings says is running', () => {
  const update = { enabled: true, isEmbeddedLaunch: false, updateId: '0199f3a2-7c41-7d2e' };

  it('names a beta update and keeps the sha and id for support', () => {
    expect(
      runningUpdate({ ...update, name: 'Vaasa-Boudreaux', sha: '5cca7d0', date: '2026-10-20' })
    ).toEqual({ label: 'Vaasa-Boudreaux · Oct 20', detail: '5cca7d0\n0199f3a2-7c41-7d2e' });
    // The publish day is a calendar date: no time zone moves it to the 19th.
    expect(runningUpdate({ ...update, name: 'Vaasa-Boudreaux', date: '2026-01-01' }).label).toBe(
      'Vaasa-Boudreaux · Jan 1'
    );
    expect(runningUpdate({ ...update, name: 'Vaasa-Boudreaux', date: 'soon' }).label).toBe(
      'Vaasa-Boudreaux'
    );
  });

  it('falls back to the short update id for an update published without a name', () => {
    expect(runningUpdate(update)).toEqual({ label: '0199f3a2', detail: '0199f3a2-7c41-7d2e' });
  });

  it('says plainly when nothing was downloaded', () => {
    expect(runningUpdate({ ...update, isEmbeddedLaunch: true, name: 'Vaasa-Boudreaux' })).toEqual({
      label: 'The version built into the app',
      detail: null,
    });
    expect(runningUpdate({ ...update, enabled: false }).label).toBe('Development / preview');
  });

  it('gives the channels their names and leaves others as they are', () => {
    expect(channelLabel('beta')).toBe('Beta');
    expect(channelLabel('production')).toBe('Production');
    expect(channelLabel('preview')).toBe('preview');
    expect(channelLabel(undefined)).toBe('Not available');
  });
});
