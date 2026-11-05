import { expect, it, mock } from 'bun:test';

it('renders reconnect status only offline and card backs at every spectator seat', async () => {
  if (!process.env.TABLE_CONNECTION_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, TABLE_CONNECTION_CHILD: '1' },
    });
    expect(child.stderr.toString()).not.toContain('(fail)');
    expect(child.exitCode).toBe(0);
    return;
  }
  const { createElement: h } = await import('react');
  const { renderToStaticMarkup: render } = await import('react-dom/server');
  const { JSDOM } = await import('jsdom');
  const view = ({ children, testID }) => h('div', { 'data-testid': testID }, children);
  let size = { width: 390, height: 844 };
  mock.module('react-native', () => ({
    View: view,
    Text: view,
    Image: ({ source }) => h('img', { src: source.uri }),
    Platform: { OS: 'web' },
    StyleSheet: { create: (x) => x, absoluteFill: {} },
  }));
  mock.module('react-native-reanimated', () => ({
    default: { View: view },
    FadeOut: { duration: () => ({}) },
    Easing: { out: (x) => x, back: () => ({}) },
    useReducedMotion: () => true,
    useSharedValue: (value) => ({ value }),
    useAnimatedStyle: () => ({}),
    withTiming: (x) => x,
    withDelay: (_, x) => x,
  }));
  mock.module('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  }));
  mock.module('../../src/components/ui/PlayerAvatar.tsx', () => ({
    PlayerAvatar: () => null,
    DEALER_SLIDE_MS: 0,
  }));
  mock.module('../../src/components/ui/PressableFX.tsx', () => ({ PressableFX: view }));
  mock.module('../../src/components/ui/StillLayer.tsx', () => ({ StillLayer: view }));
  mock.module('../../src/components/ui/PidroText.tsx', () => ({ PidroText: view }));
  mock.module('../../src/game/canvas/HandResult.tsx', () => ({ viewerOf: () => null }));
  mock.module('../../src/game/canvas/TableChrome.tsx', () => ({
    TABLE_HEADER: 56,
    useTableSize: () => size,
  }));
  mock.module('../../src/game/canvas/bakedBlur.tsx', () => ({ bakedShadow: () => null }));
  mock.module('../../src/utils/cardImages.ts', () => ({
    getCardImage: () => ({ uri: 'card-back.png' }),
  }));
  const shared = await import('@pidro/shared');
  mock.module('../../src/i18n/index.ts', () => ({
    ...shared,
    useTranslation: () => ({ t: shared.t }),
  }));
  const { SeatLayer } = await import('../../src/game/canvas/SeatLayer.tsx');
  const { ConnectionBanner } = await import('../../src/components/ui/ConnectionBanner.tsx');
  expect(render(h(ConnectionBanner, { isConnected: true }))).toBe('');
  expect(render(h(ConnectionBanner, { isConnected: false }))).toContain('Reconnecting…');
  const counts = { north: 5, east: 3, south: 7, west: 2 };
  const seats = Object.fromEntries(
    Object.entries(counts).map(([position, cardCount]) => [
      position,
      {
        absolutePosition: position,
        relativePosition: position,
        username: position,
        cardCount,
        isYou: false,
        isOpponent: position === 'east' || position === 'west',
        isTeammate: false,
        seatStatus: 'normal',
        isConnected: true,
        foldedCount: 0,
        out: false,
      },
    ])
  );
  for (size of [
    { width: 390, height: 844 },
    { width: 375, height: 667 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
  ]) {
    const dom = new JSDOM(render(h(SeatLayer, { seats, levels: false })));
    for (const [seat, count] of Object.entries(counts)) {
      expect(
        dom.window.document.querySelectorAll(`[data-testid="seat-${seat}-cards"] img`)
      ).toHaveLength(count);
    }
    dom.window.close();
  }
});
