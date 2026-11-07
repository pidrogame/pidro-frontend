import { expect, test, mock } from 'bun:test';

test('startup applies before entry, releases at the cap, and never interrupts play', async () => {
  if (!process.env.STARTUP_UPDATE_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, STARTUP_UPDATE_CHILD: '1' },
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
  let foreground;
  const appState = {
    currentState: 'active',
    addEventListener: (_, listener) => {
      foreground = listener;
      return { remove() {} };
    },
  };
  let update;
  let check;
  let fetch;
  let reload;
  let reloads = 0;
  let reloadError = false;
  let checks = 0;
  let fetches = 0;
  let lastLaunch = 'running-update';
  mock.module('@react-native-async-storage/async-storage', () => ({
    default: {
      getItem: async () => lastLaunch,
      setItem: async (_, value) => {
        lastLaunch = value;
      },
    },
  }));
  mock.module('react-native', () => ({ Platform: { OS: 'ios' }, AppState: appState, Linking: {} }));
  mock.module('expo-application', () => ({ nativeApplicationVersion: '3.2.4' }));
  mock.module('expo-updates', () => ({
    isEnabled: true,
    isEmergencyLaunch: false,
    isEmbeddedLaunch: false,
    updateId: 'running-update',
    useUpdates: () => update,
    checkForUpdateAsync: () => {
      checks++;
      return check.promise;
    },
    fetchUpdateAsync: () => {
      fetches++;
      return fetch.promise;
    },
    reloadAsync: async () => {
      reloads++;
      if (reloadError) throw new Error('reload failed');
      return reload.promise;
    },
  }));
  const { useStartupUpdate } = await import('../../src/hooks/useStartupUpdate.ts');
  const { useGameStore } = await import('@pidro/shared');
  let result;
  function Root() {
    result = useStartupUpdate();
    return h('div', null, result.waiting ? 'startup' : 'app');
  }
  const root = createRoot(document.getElementById('root'));
  const realNow = Date.now;
  const realTimeout = globalThis.setTimeout;
  let now = 0;
  let deadline;
  Date.now = () => now;
  globalThis.setTimeout = (callback, ms, ...args) => {
    if (ms === 5000) deadline = callback;
    return realTimeout(callback, ms === 5000 ? 60_000 : ms, ...args);
  };
  async function start(overrides = {}, roomCode = null) {
    await act(async () => root.render(null));
    now = 0;
    reloads = 0;
    checks = 0;
    fetches = 0;
    reloadError = false;
    appState.currentState = 'active';
    check = Promise.withResolvers();
    fetch = Promise.withResolvers();
    reload = Promise.withResolvers();
    update = { restartCount: 0, isUpdatePending: false, ...overrides };
    useGameStore.setState({ roomCode });
    await act(async () => root.render(h(Root)));
  }
  const answer = async (deferred, value) => act(async () => deferred.resolve(value));
  try {
    await start();
    expect(result.waiting).toBe(true);
    now = 1200;
    await answer(check, { isAvailable: true });
    expect(result.updating).toBe(true);
    now = 4999;
    await answer(fetch, { isNew: true });
    expect(reloads).toBe(1);
    now = 5000;
    await act(async () => deadline());
    expect(result.waiting).toBe(true); // Native reload cannot be cancelled: never admit a game now.
    await act(async () => {
      appState.currentState = 'background';
      foreground('background');
    });
    await act(async () => {
      appState.currentState = 'active';
      foreground('active');
    });
    update.restartCount = 1;
    await act(async () => root.render(h(Root)));
    expect(result.waiting).toBe(true);
    await answer(reload, undefined); // Expo resolves before replacing the JS runtime.
    expect(result.waiting).toBe(true);
    expect(reloads).toBe(1);

    await start({ isUpdatePending: true });
    expect(reloads).toBe(1);
    expect(checks).toBe(0);

    await start();
    now = 4200;
    await answer(check, { isAvailable: true });
    now = 5000;
    await act(async () => deadline());
    expect(result.waiting).toBe(false);
    await answer(fetch, { isNew: true });
    expect(reloads).toBe(0);
    update.isUpdatePending = true;
    await act(async () => root.render(h(Root)));
    await act(async () => foreground('active'));
    expect(reloads).toBe(0);

    await start();
    now = 5000;
    await act(async () => deadline());
    await answer(check, { isAvailable: true });
    expect(fetches).toBe(1); // Slow check still finishes the download in the background.
    await answer(fetch, { isNew: true });
    expect(result.waiting).toBe(false);
    expect(reloads).toBe(0);

    await start({ isUpdatePending: true }, 'SEATED');
    expect(result.waiting).toBe(false);
    expect(reloads).toBe(0);
    await start();
    await answer(check, { isAvailable: true });
    await act(async () => useGameStore.setState({ roomCode: 'SEATED' }));
    await answer(fetch, { isNew: true });
    expect(reloads).toBe(0);

    await start();
    await answer(check, { isAvailable: true });
    await act(async () => {
      appState.currentState = 'background';
      foreground('background');
    });
    await answer(fetch, { isNew: true });
    await act(async () => {
      appState.currentState = 'active';
      foreground('active');
    });
    expect(result.waiting).toBe(false);
    expect(reloads).toBe(0);

    await start();
    await answer(check, { isAvailable: false });
    expect(result.waiting).toBe(false);
    expect(fetches).toBe(0);
    await start();
    await act(async () => check.reject(new Error('offline')));
    expect(result.waiting).toBe(false);
    expect(checks).toBe(1);
    await start();
    await answer(check, { isAvailable: true });
    await act(async () => fetch.reject(new Error('download failed')));
    expect(result.waiting).toBe(false);
    expect(reloads).toBe(0);
    await start();
    reloadError = true;
    await answer(check, { isAvailable: true });
    await answer(fetch, { isNew: true });
    expect(result.waiting).toBe(false);
    expect(reloads).toBe(1);

    await start({ restartCount: 1 });
    expect(result.waiting).toBe(false);
    expect(checks).toBe(0);
    await start({ isStartupProcedureRunning: true, isDownloading: true });
    expect(checks).toBe(0);
    update = {
      ...update,
      isStartupProcedureRunning: false,
      isDownloading: false,
      isUpdatePending: true,
    };
    await act(async () => root.render(h(Root)));
    expect(reloads).toBe(1);
    expect(checks).toBe(0);
    lastLaunch = 'previous-update';
    await start();
    expect(result.waiting).toBe(false);
    expect(checks).toBe(0); // Native launched the new cached bundle without a network wait.
    expect(lastLaunch).toBe('running-update');
  } finally {
    await act(async () => root.unmount());
    Date.now = realNow;
    globalThis.setTimeout = realTimeout;
    useGameStore.setState({ roomCode: null });
    dom.window.close();
  }
});
