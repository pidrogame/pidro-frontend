import { expect, it, mock } from 'bun:test';

it('keeps the hand log open across turns and hands, but closes it on leaving the room', async () => {
  // Isolate native view doubles from the socket tests' React Native module.
  if (!process.env.SCOREBOARD_TEST_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, SCOREBOARD_TEST_CHILD: '1' },
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
  });
  const view = ({ children }) => h('div', null, children);
  mock.module('react-native', () => ({
    View: view,
    Platform: { OS: 'web' },
    StyleSheet: { create: (styles) => styles },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  }));
  mock.module('react-native-reanimated', () => ({
    default: { View: view },
    Easing: { out: () => {}, quad: () => {} },
    cancelAnimation: () => {},
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (value) => ({ value }),
    withDelay: () => {},
    withSequence: () => {},
    withTiming: (value) => value,
  }));
  mock.module('../../src/components/ui/Bevel.tsx', () => ({ gradientBg: () => ({}) }));
  mock.module('../../src/components/ui/Icon.tsx', () => ({ Icon: () => null }));
  mock.module('../../src/components/ui/PidroText.tsx', () => ({ PidroText: view }));
  mock.module('../../src/components/ui/PressableFX.tsx', () => ({
    PressableFX: ({ onPress, children }) => h('button', { onClick: onPress }, children),
  }));
  mock.module('../../src/components/game/HandHistory.tsx', () => ({ HandHistory: () => null }));
  mock.module('../../src/game/canvas/HandResult.tsx', () => ({
    SCORE_COUNT: { delayMs: 0, ms: 0 },
  }));
  mock.module('../../src/game/canvas/bakedBlur.tsx', () => ({ BoxShadow: () => null }));
  mock.module('../../src/game/canvas/ActionTicker.tsx', () => ({
    ActionTicker: ({ onOpenLog }) =>
      h('button', { onClick: onOpenLog, id: 'open-log' }, 'This hand'),
  }));
  mock.module('../../src/game/canvas/TableUtilityWindow.tsx', () => ({
    TableUtilityWindow: ({ open, children, onClose }) =>
      open
        ? h('section', null, children, h('button', { id: 'close-log', onClick: onClose }, 'Close'))
        : null,
  }));
  const shared = await import('@pidro/shared');
  mock.module('../../src/i18n/index.ts', () => ({
    ...shared,
    useTranslation: () => ({ t: shared.t, locale: 'en' }),
  }));
  const { Scoreboard } = await import('../../src/game/canvas/Scoreboard.tsx');
  const root = createRoot(document.getElementById('root'));
  const props = {
    scores: null,
    youPosition: 'south',
    roomCode: 'FIRST',
    yourTurn: false,
    resting: { who: null, what: 'Bid 7', ours: true },
  };
  const render = async (next = {}) =>
    act(async () => root.render(h(Scoreboard, { ...props, ...next })));
  const click = async (id) => act(async () => document.getElementById(id).click());
  try {
    await render();
    await click('open-log');
    expect(document.getElementById('close-log')).not.toBeNull();
    await render({ yourTurn: true, history: [{ hand_number: 3 }] });
    expect(document.getElementById('close-log')).not.toBeNull();
    await render({ yourTurn: false, history: [{ hand_number: 3 }, { hand_number: 4 }] });
    expect(document.getElementById('close-log')).not.toBeNull();
    await click('close-log');
    expect(document.getElementById('close-log')).toBeNull();
    await click('open-log');
    await render({ roomCode: 'SECOND' });
    expect(document.getElementById('close-log')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
