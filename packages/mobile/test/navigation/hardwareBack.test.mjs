import { expect, mock, test } from 'bun:test';

// PID-420: the waiting room's folded talk takes Android's back as the header's back does.
// PID-458: only then does the table's own back ask before you leave.
test('Android back unfolds the talk, then asks before leaving', async () => {
  if (!process.env.HARDWARE_BACK_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, HARDWARE_BACK_CHILD: '1' },
    });
    expect(child.stderr.toString()).not.toContain('(fail)');
    expect(child.exitCode).toBe(0);
    return;
  }
  const { JSDOM } = await import('jsdom');
  const { act, createElement: h, useCallback, useState } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  // React Native's BackHandler: the newest listener first, until one handles the press.
  const listeners = [];
  const back = () => [...listeners].reverse().some((listener) => listener());
  mock.module('react-native', () => ({
    Platform: { OS: 'android' },
    BackHandler: {
      addEventListener: (_, listener) => {
        listeners.push(listener);
        return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
      },
    },
  }));
  mock.module('expo-router', () => ({ useRouter: () => ({}) }));
  mock.module('@/stores/auth', () => ({ useAuthStore: () => true }));
  const { useHardwareBack } = await import('../../src/hooks/useFlowBack.ts');
  let folded;
  // As NewTableScreen wires it: `useHardwareBack(folded, unfold)`.
  function Room() {
    const [typing, setTyping] = useState(true);
    folded = typing;
    const unfold = useCallback(() => setTyping(false), []);
    useHardwareBack(typing, unfold);
    return null;
  }
  // As the game route's LeaveOnBack wires it, before the screen: a fresh callback every render.
  const asked = [];
  function Table({ version }) {
    useHardwareBack(true, () => asked.push(version));
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  const render = (version) => root.render(h('div', null, h(Table, { version }), h(Room)));
  await act(async () => render(1));
  expect(folded).toBe(true);
  // The channel re-renders the route while you type; its listener must not jump ahead.
  await act(async () => render(2));
  // Folded: back is handled here and unfolds; the table never sees it, so nothing asks.
  await act(async () => {
    expect(back()).toBe(true);
  });
  expect(folded).toBe(false);
  expect(asked).toEqual([]);
  // Unfolded: the table asks, with what it says now.
  expect(back()).toBe(true);
  expect(asked).toEqual([2]);
  await act(async () => root.unmount());
  expect(listeners).toHaveLength(0);
});
