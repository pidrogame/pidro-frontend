import { describe, expect, it, mock } from 'bun:test';
import { channelLabel, runningUpdate, nativeStoreUpdate } from '../../src/features/appUpdate.ts';

it('opens only the server destination below its configured native minimum', () => {
  const minimum = { android: '3.2.10', ios: '3.3.0' };
  const urls = {
    android: 'https://example.test/android?release=public',
    ios: 'https://example.test/ios?release=public',
  };
  expect(nativeStoreUpdate('android', '3.2.9', minimum, urls)).toEqual({
    id: `android:3.2.10:${urls.android}`,
    url: urls.android,
  });
  expect(nativeStoreUpdate('ios', '3.2.10', minimum, urls)?.url).toBe(urls.ios);
  expect(nativeStoreUpdate('android', '3.2.10', minimum, urls)).toBeNull();
  expect(nativeStoreUpdate('android', '3.2.11', minimum, urls)).toBeNull();
  expect(nativeStoreUpdate('android', '3.10.0', minimum, urls)).toBeNull();
  expect(nativeStoreUpdate('ios', '3.3.0', minimum, urls)).toBeNull();
  expect(nativeStoreUpdate('ios', '3.2.2', { android: '3.2.10' }, urls)).toBeNull();
  expect(nativeStoreUpdate('android', '3.2.2', {}, urls)).toBeNull();
  expect(nativeStoreUpdate('web', '3.2.2', minimum, urls)).toBeNull();
  expect(nativeStoreUpdate('android', null, minimum, urls)).toBeNull();
  expect(nativeStoreUpdate('android', '3.2.2', { android: 'not-a-version' }, urls)).toBeNull();
  expect(nativeStoreUpdate('android', '3.2.2', minimum, {})).toBeNull();
  expect(nativeStoreUpdate('android', '3.2.2', minimum, { ios: urls.ios })).toBeNull();
  expect(nativeStoreUpdate('android', '3.2.2', minimum, { android: '' })).toBeNull();
});

it('keeps store notices out of games, opens the listing, and remembers dismissal', async () => {
  if (!process.env.STORE_NOTICE_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, STORE_NOTICE_CHILD: '1' },
    });
    expect(child.stderr.toString()).not.toContain('(fail)');
    expect(child.exitCode).toBe(0);
    return;
  }
  const { JSDOM } = await import('jsdom');
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    __DEV__: false,
  });
  const opened = [];
  mock.module('react-native', () => ({
    Platform: { OS: 'android' },
    AppState: { addEventListener: () => ({ remove() {} }) },
    Linking: { openURL: async (url) => opened.push(url) },
  }));
  mock.module('expo-application', () => ({ nativeApplicationVersion: '3.2.3' }));
  mock.module('expo-updates', () => ({
    isEnabled: true,
    useUpdates: () => ({ isUpdatePending: true, downloadedUpdate: { updateId: 'ota' } }),
    reloadAsync: async () => {
      throw new Error('Store action must not restart');
    },
  }));
  const { useAppUpdate } = await import('../../src/hooks/useAppUpdate.ts');
  const { useLobbyStore } = await import('@pidro/shared');
  let notice;
  function Shell({ inGame = false }) {
    notice = useAppUpdate({ inGame });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  try {
    useLobbyStore.setState({ minimumNativeVersions: { android: '3.3.0' } });
    await act(async () => root.render(h(Shell)));
    expect(notice.store).toBe(false);
    expect(notice.visible).toBe(false); // A pending OTA never offers a shell restart.
    await act(async () =>
      useLobbyStore.setState({ nativeStoreUrls: { android: 'https://example.test/android' } })
    );
    expect(notice.store).toBe(true);
    expect(notice.visible).toBe(true);
    await act(async () => root.render(h(Shell, { inGame: true })));
    expect(notice.visible).toBe(false);
    await act(async () => root.render(h(Shell)));
    await act(async () => notice.restart());
    expect(opened).toEqual(['https://example.test/android']);
    await act(async () => notice.dismiss());
    expect(notice.store).toBe(false);
    expect(notice.visible).toBe(false);
    await act(async () => root.render(null));
    await act(async () => root.render(h(Shell)));
    expect(notice.store).toBe(false);
    await act(async () =>
      useLobbyStore.setState({ nativeStoreUrls: { android: 'https://example.test/public' } })
    );
    expect(notice.store).toBe(true);
    await act(async () => notice.restart());
    expect(opened.at(-1)).toBe('https://example.test/public');
    await act(async () => useLobbyStore.setState({ nativeStoreUrls: {} }));
    expect(notice.store).toBe(false);
    await act(async () =>
      useLobbyStore.setState({ nativeStoreUrls: { android: 'https://example.test/android' } })
    );
    expect(notice.store).toBe(false);
    await act(async () => useLobbyStore.setState({ minimumNativeVersions: { android: '3.4.0' } }));
    expect(notice.store).toBe(true);
    await act(async () => useLobbyStore.setState({ minimumNativeVersions: {} }));
    expect(notice.store).toBe(false);
  } finally {
    await act(async () => root.unmount());
    useLobbyStore.getState().reset();
    dom.window.close();
  }
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
