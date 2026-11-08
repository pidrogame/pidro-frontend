import { describe, expect, it } from 'bun:test';
import { channelLabel, runningUpdate, nativeStoreUpdate } from '../../src/features/appUpdate.ts';

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
