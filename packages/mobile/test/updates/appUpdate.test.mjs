import { describe, expect, it, mock } from 'bun:test';
import {
  channelLabel,
  runningUpdate,
  shouldCheckOnForeground,
  shouldShowUpdateNotice,
  nativeStoreUpdate,
  UPDATE_CHECK_INTERVAL_MS,
} from '../../src/features/appUpdate.ts';

const ready = {
  enabled: true,
  isUpdatePending: true,
  downloadedUpdateId: 'update-2',
  dismissedUpdateId: null,
  inGame: false,
};

it('offers the platform store only below its configured native minimum', () => {
  const minimum = { android: '3.2.10', ios: '3.3.0' };
  expect(nativeStoreUpdate('android', '3.2.9', minimum)).toEqual({
    id: 'android:3.2.10',
    url: 'https://play.google.com/store/apps/details?id=com.oneapps.pidro.beta',
  });
  expect(nativeStoreUpdate('ios', '3.2.10', minimum)?.url).toBe(
    'https://testflight.apple.com/join/2JR95b65'
  );
  expect(nativeStoreUpdate('android', '3.2.10', minimum)).toBeNull();
  expect(nativeStoreUpdate('android', '3.2.11', minimum)).toBeNull();
  expect(nativeStoreUpdate('android', '3.10.0', minimum)).toBeNull();
  expect(nativeStoreUpdate('ios', '3.3.0', minimum)).toBeNull();
  expect(nativeStoreUpdate('ios', '3.2.2', { android: '3.2.10' })).toBeNull();
  expect(nativeStoreUpdate('android', '3.2.2', {})).toBeNull();
  expect(nativeStoreUpdate('web', '3.2.2', minimum)).toBeNull();
  expect(nativeStoreUpdate('android', null, minimum)).toBeNull();
  expect(nativeStoreUpdate('android', '3.2.2', { android: 'not-a-version' })).toBeNull();
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
    expect(notice.store).toBe(true);
    expect(notice.visible).toBe(true);
    await act(async () => root.render(h(Shell, { inGame: true })));
    expect(notice.visible).toBe(false);
    await act(async () => root.render(h(Shell)));
    await act(async () => notice.restart());
    expect(opened).toEqual([
      'https://play.google.com/store/apps/details?id=com.oneapps.pidro.beta',
    ]);
    await act(async () => notice.dismiss());
    expect(notice.store).toBe(false);
    expect(notice.visible).toBe(true); // The independent OTA offer is still available.
    await act(async () => root.render(null));
    await act(async () => root.render(h(Shell)));
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

describe('update notice', () => {
  it('shows once an update has downloaded', () => {
    expect(shouldShowUpdateNotice(ready)).toBe(true);
  });

  it('stays away until the update has downloaded', () => {
    expect(shouldShowUpdateNotice({ ...ready, isUpdatePending: false })).toBe(false);
  });

  it('never shows in a build without OTA updates', () => {
    expect(shouldShowUpdateNotice({ ...ready, enabled: false })).toBe(false);
  });

  it('never shows at the table', () => {
    expect(shouldShowUpdateNotice({ ...ready, inGame: true })).toBe(false);
  });

  it('stays dismissed for that update, and returns for a newer one', () => {
    const dismissed = { ...ready, dismissedUpdateId: 'update-2' };
    expect(shouldShowUpdateNotice(dismissed)).toBe(false);
    expect(shouldShowUpdateNotice({ ...dismissed, downloadedUpdateId: 'update-3' })).toBe(true);
  });

  it('can be dismissed when Expo does not say which update is pending', () => {
    const unnamed = { ...ready, downloadedUpdateId: undefined };
    expect(shouldShowUpdateNotice(unnamed)).toBe(true);
    expect(shouldShowUpdateNotice({ ...unnamed, dismissedUpdateId: 'pending' })).toBe(false);
  });
});

describe('foreground update check', () => {
  const now = 1_000_000_000;
  const quiet = { enabled: true, busy: false, now };

  it('checks when nothing has checked yet', () => {
    expect(shouldCheckOnForeground({ ...quiet, lastCheckedAt: null })).toBe(true);
  });

  it('waits fifteen minutes between checks', () => {
    const justUnder = now - UPDATE_CHECK_INTERVAL_MS + 1;
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(15 * 60 * 1000);
    expect(shouldCheckOnForeground({ ...quiet, lastCheckedAt: justUnder })).toBe(false);
    expect(
      shouldCheckOnForeground({ ...quiet, lastCheckedAt: now - UPDATE_CHECK_INTERVAL_MS })
    ).toBe(true);
  });

  it('does not check while a check or download is running, or without OTA', () => {
    expect(shouldCheckOnForeground({ ...quiet, busy: true, lastCheckedAt: null })).toBe(false);
    expect(shouldCheckOnForeground({ ...quiet, enabled: false, lastCheckedAt: null })).toBe(false);
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
