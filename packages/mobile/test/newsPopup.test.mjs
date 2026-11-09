import { describe, expect, test, mock } from 'bun:test';
import { popupForStart, parseNewsMarkdown } from '../src/features/newsPopup';

const post = { id: 41, title: 'A quieter table', body: '**Your turn**', app_update: false };
const start = {
  post,
  handled: new Set(),
  ready: true,
  atHome: true,
  inGame: false,
};

describe('a News popup at cold start', () => {
  test('waits for startup and Home, and never interrupts a game', () => {
    expect(popupForStart(start)).toBe(post);
    expect(popupForStart({ ...start, ready: false })).toBeNull();
    expect(popupForStart({ ...start, atHome: false })).toBeNull();
    expect(popupForStart({ ...start, inGame: true })).toBeNull();
    expect(popupForStart({ ...start, post: null })).toBeNull();
  });

  test('handles each post once, not every Home visit or foreground', () => {
    expect(popupForStart({ ...start, handled: new Set([41]) })).toBeNull();
    expect(popupForStart({ ...start, handled: new Set([40]) })).toBe(post);
  });

  test('Later lasts only this cold start; the server decides eligibility on the next', () => {
    const update = { ...post, app_update: true };
    expect(popupForStart({ ...start, post: update, handled: new Set([41]) })).toBeNull();
    expect(popupForStart({ ...start, post: update })).toBe(update);
    // After an acknowledgement or installing the new version the server offers nothing.
    expect(popupForStart({ ...start, post: null })).toBeNull();
  });

  test('legacy minimums still work, but never resurrect an acknowledged popup policy', () => {
    const fallback = { ...post, id: 0, app_update: true };
    expect(popupForStart({ ...start, post: null, fallback })).toBe(fallback);
    expect(popupForStart({ ...start, post: null, fallback, nativeUpdatePopup: true })).toBeNull();
    expect(popupForStart({ ...start, fallback, handled: new Set([41]) })).toBeNull();
    expect(popupForStart({ ...start, post: null, fallback, handled: new Set([0]) })).toBeNull();
  });
});

test('News Markdown renders bold, line breaks and safe links, leaving other syntax as text', () => {
  expect(
    parseNewsMarkdown('Keep **your seat**.\n[Help](https://pidro.online/help) or *wait*.')
  ).toEqual([
    { text: 'Keep ' },
    { text: 'your seat', bold: true },
    { text: '.\n' },
    { text: 'Help', url: 'https://pidro.online/help' },
    { text: ' or *wait*.' },
  ]);
  expect(parseNewsMarkdown('[Bad](javascript:alert) <b>plain</b>')).toEqual([
    { text: '[Bad](javascript:alert) <b>plain</b>' },
  ]);
});

test('popup actions acknowledge only the current player, retry failures, and keep Later local', async () => {
  if (!process.env.NEWS_POPUP_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, NEWS_POPUP_CHILD: '1' },
    });
    expect(child.stderr.toString()).not.toContain('(fail)');
    expect(child.exitCode).toBe(0);
    return;
  }
  const { JSDOM } = await import('jsdom');
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { create } = await import('zustand');
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    __DEV__: false,
  });
  const auth = create(() => ({ user: { id: 'a' } }));
  const news = create(() => ({
    popup: post,
    popupLoaded: true,
    welcomeReady: true,
    status: 'ready',
    locale: 'en',
  }));
  const lobby = create(() => ({
    minimumNativeVersions: {},
    minimumNativeBuilds: {},
    nativeStoreUrls: { android: 'https://example.test/android' },
    nativeUpdatePopup: true,
  }));
  let path = '/home';
  let open = async () => {};
  let failReceipt = false;
  const receipts = [];
  const box = ({ children }) => h('div', null, children);
  const button = ({ label, onPress, disabled, loading }) =>
    h('button', { onClick: onPress, disabled: disabled || loading }, label);
  mock.module('react-native', () => ({
    Platform: { OS: 'android' },
    Linking: { openURL: (url) => open(url) },
    StyleSheet: { create: (styles) => styles },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    View: box,
    Modal: box,
    ScrollView: box,
    Image: box,
  }));
  mock.module('expo-application', () => ({
    nativeApplicationVersion: '3.2.3',
    nativeBuildVersion: '11',
  }));
  mock.module('expo-asset', () => ({ Asset: {} }));
  mock.module('expo-constants', () => ({
    default: { expoConfig: { extra: { variant: 'beta' } } },
  }));
  mock.module('expo-router', () => ({
    useIsFocused: () => path === '/home',
    usePathname: () => path,
  }));
  mock.module('react-native-reanimated', () => ({ useReducedMotion: () => true }));
  mock.module('react-native-safe-area-context', () => ({
    SafeAreaProvider: box,
    SafeAreaView: box,
  }));
  mock.module('@/stores/auth', () => ({ useAuthStore: auth }));
  mock.module('@/stores/news', () => ({ useNewsStore: news }));
  mock.module('@/stores/lobby', () => ({ useLobbyStore: lobby }));
  mock.module('@/api/news', () => ({
    newsApi: {
      popupSeen: async (id) => {
        if (failReceipt) throw new Error('offline');
        receipts.push([auth.getState().user.id, id]);
      },
    },
  }));
  mock.module('@/i18n', () => ({ useTranslation: () => ({ locale: 'en', t: (key) => key }) }));
  mock.module('@/components/ui/BevelButton', () => ({ BevelButton: button }));
  mock.module('@/components/ui/TextLink', () => ({ TextLink: button }));
  mock.module('@/components/ui/Surface', () => ({ Surface: box }));
  mock.module('@/components/ui/PidroText', () => ({
    PidroText: ({ children }) => h('span', null, children),
  }));
  const { NewsPopup } = await import('../src/components/news/NewsPopup');
  const root = createRoot(document.getElementById('root'));
  const render = () => root.render(h(NewsPopup, { blocked: false }));
  const click = async (label) =>
    act(async () => {
      const target = [...document.querySelectorAll('button')].find(
        (node) => node.textContent === label
      );
      expect(target).toBeDefined();
      target.click();
    });
  try {
    path = '/game/room';
    await act(render);
    expect(document.querySelectorAll('button')).toHaveLength(0);
    path = '/home';
    await act(render);
    failReceipt = true;
    await click('news.gotIt');
    expect(document.body.textContent).toContain('news.popupFailed');
    expect(receipts).toEqual([]);
    failReceipt = false;
    await click('news.gotIt');
    expect(receipts).toEqual([['a', 41]]);
    await act(() => root.render(null));
    await act(render);
    expect(document.querySelectorAll('button')).toHaveLength(0);

    await act(() => news.setState({ popup: { ...post, id: 42, app_update: true } }));
    // No build minimum from the lobby: no build line.
    expect(document.body.textContent).not.toContain('You have build');
    await click('news.later');
    expect(receipts).toEqual([['a', 41]]);
    await act(() => root.render(null));
    await act(render);
    expect(document.querySelectorAll('button')).toHaveLength(0);

    await act(() => news.setState({ popup: { ...post, id: 43, app_update: true } }));
    open = async () => {
      throw new Error('no handler');
    };
    await click('Update in Google Play');
    expect(receipts).toEqual([['a', 41]]);
    expect(document.body.textContent).toContain('news.popupFailed');
    let resolveLink;
    open = () =>
      new Promise((resolve) => {
        resolveLink = resolve;
      });
    await click('Update in Google Play');
    await act(() => auth.setState({ user: { id: 'b' } }));
    await act(async () => resolveLink());
    expect(receipts).toEqual([['a', 41]]);
    open = async () => {};
    await click('Update in Google Play');
    expect(receipts).toEqual([
      ['a', 41],
      ['b', 43],
    ]);
    expect(document.querySelectorAll('button')).toHaveLength(0);
    await act(() => auth.setState({ user: { id: 'a' } }));
    await click('Update in Google Play');
    expect(receipts.at(-1)).toEqual(['a', 43]);
    expect(document.querySelectorAll('button')).toHaveLength(0);

    // No post, and the server's minimums: build 11 of 3.2.3 is new enough, until 12 is out.
    await act(() => {
      news.setState({ popup: null });
      lobby.setState({
        minimumNativeVersions: { android: '3.2.3' },
        minimumNativeBuilds: { android: '11' },
        nativeUpdatePopup: false,
      });
    });
    expect(document.querySelectorAll('button')).toHaveLength(0);
    await act(() => lobby.setState({ minimumNativeBuilds: { android: '12' } }));
    expect(document.body.textContent).toContain('news.updateTitle');
    expect(document.body.textContent).toContain('You have build 11 · this is build 12');
    await click('Update in Google Play');
    expect(receipts.at(-1)).toEqual(['a', 43]);
  } finally {
    await act(() => root.unmount());
    dom.window.close();
  }
});
