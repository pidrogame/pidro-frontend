import { expect, mock, test } from 'bun:test';

// PID-420: the waiting room's folded talk takes Android's back as the header's back does.
test('Android back unfolds the talk, then leaves', async () => {
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
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(h(Room)));
  expect(folded).toBe(true);
  // Folded: back is handled here and unfolds; the route never sees it, so you stay seated.
  let handled;
  await act(async () => {
    handled = back();
  });
  expect(handled).toBe(true);
  expect(folded).toBe(false);
  // Unfolded: nothing here handles it, so the route's own back leaves the table.
  expect(back()).toBe(false);
  expect(listeners).toHaveLength(0);
  await act(async () => root.unmount());
});
