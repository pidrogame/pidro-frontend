import { expect, it, jest, mock } from 'bun:test';

// PID-462: seat notices and action notices share the table's one notice slot, as
// GameCanvasTable draws them: an action notice covers a seat notice. A notice's time
// runs only while it shows, and a tap closes the notice it landed on and nothing else.

it('a seat notice that waited behind an action notice gets its full time', async () => {
  await check('seat-waits');
});

it('a seat notice an action notice covers keeps the time it had left', async () => {
  await check('seat-covered');
});

it('a tap as a notice runs out closes that notice, not the next one', async () => {
  await check('tap-at-expiry');
});

it('a press that goes down as a notice runs out and lifts on the next closes neither', async () => {
  await check('press-across-expiry');
});

it('control: a single notice stays its reading time, and a tap closes it at once', async () => {
  await check('single');
});

async function check(scenario) {
  // The React Native stand-ins below are process-wide, so each case runs in its own child.
  if (!process.env.TABLE_FEEDBACK_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, TABLE_FEEDBACK_CHILD: scenario },
    });
    expect(child.stderr.toString()).not.toContain('(fail)');
    expect(child.exitCode).toBe(0);
    return;
  }
  if (process.env.TABLE_FEEDBACK_CHILD !== scenario) return;

  const { JSDOM } = await import('jsdom');
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  jest.useFakeTimers();

  const box = ({ children }) => h('div', null, children);
  mock.module('react-native', () => ({
    AccessibilityInfo: { announceForAccessibilityWithOptions: () => {} },
    Platform: { OS: 'android' },
    Pressable: box,
    ScrollView: box,
    StyleSheet: { create: (styles) => styles },
    Text: box,
    View: box,
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  }));
  mock.module('react-native-safe-area-context', () => ({
    SafeAreaView: box,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  }));
  mock.module('../../src/game/canvas/TableChrome.tsx', () => ({
    TABLE_HEADER: 0,
    useTableReserves: () => ({ landscape: false, noticeSlot: {} }),
  }));
  mock.module('../../src/i18n/index.ts', () => ({ useTranslation: () => ({ t: (key) => key }) }));
  mock.module('../../src/components/ui/PidroText.tsx', () => ({ PidroText: box }));
  mock.module('../../src/components/ui/PressableFX.tsx', () => ({
    PressableFX: ({ testID, onPressIn, onPress, children }) =>
      h('button', { 'data-testid': testID, onMouseDown: onPressIn, onClick: onPress }, children),
  }));

  const { TableFeedback, useTableNotices } = await import(
    '../../src/components/game/TableFeedback.tsx'
  );
  const { noticeHoldMs, tableNoticeText } = await import('../../src/game/tableNotices.ts');

  const lost = {
    key: 'game.notice_disconnected_seat',
    seat: { name: 'Nora', position: 'north' },
    variant: 'warning',
  };
  const refused = { message: 'That card can’t be played now', variant: 'error' };
  const back = { message: 'Nora is back', variant: 'success' };
  const seatHold = noticeHoldMs([lost]);
  const actionHold = noticeHoldMs([refused]);

  // The table's composition (GameCanvasTable): the action notice first, else the seat's.
  let queues;
  function Table() {
    const action = useTableNotices('ROOM');
    const seat = useTableNotices('ROOM');
    queues = { action, seat };
    return h(TableFeedback, {
      notice: action.notice ?? seat.notice ?? null,
      onDismiss: action.notice ? action.dismissNotice : seat.dismissNotice,
    });
  }

  const root = createRoot(document.getElementById('root'));
  const advance = (ms) => act(async () => jest.advanceTimersByTime(ms));
  const add = (queue, notice) => act(async () => queues[queue].addNotice(notice));
  const shown = () => document.querySelector('[data-testid="table-feedback"]')?.textContent ?? null;
  const seatText = tableNoticeText(lost);
  try {
    await act(async () => root.render(h(Table)));

    if (scenario === 'seat-waits') {
      // The action notice is up; one second later Nora drops.
      await add('action', refused);
      await advance(1000);
      await add('seat', lost);
      expect(shown()).toBe(refused.message);
      await advance(actionHold - 1000 - 1);
      expect(shown()).toBe(refused.message);
      await advance(1);
      expect(shown()).toBe(seatText);
      // Its whole time on screen, counted from here.
      await advance(seatHold - 1);
      expect(shown()).toBe(seatText);
      await advance(1);
      expect(shown()).toBe(null);
    }

    if (scenario === 'seat-covered') {
      // Nora drops; one second later a card is refused and covers her notice.
      await add('seat', lost);
      await advance(1000);
      await add('action', refused);
      expect(shown()).toBe(refused.message);
      await advance(actionHold);
      // The second it had on screen counts; the time it was covered does not.
      expect(shown()).toBe(seatText);
      await advance(seatHold - 1000 - 1);
      expect(shown()).toBe(seatText);
      await advance(1);
      expect(shown()).toBe(null);
    }

    if (scenario === 'tap-at-expiry') {
      await add('seat', lost);
      await add('seat', back);
      // The tap lands on Nora's notice in the same moment its time runs out.
      const button = document.querySelector('[data-testid="table-feedback"]');
      await act(async () => {
        jest.advanceTimersByTime(seatHold);
        button.click();
      });
      expect(shown()).toBe(back.message);
      // Control: a tap on the notice now showing closes it.
      await act(async () => document.querySelector('[data-testid="table-feedback"]').click());
      expect(shown()).toBe(null);
    }

    if (scenario === 'press-across-expiry') {
      await add('seat', lost);
      await add('seat', back);
      await advance(seatHold - 100);
      // The finger goes down on Nora's notice; it runs out; the finger lifts on the next.
      const press = (type) =>
        document
          .querySelector('[data-testid="table-feedback"]')
          .dispatchEvent(new window.MouseEvent(type, { bubbles: true }));
      await act(async () => press('mousedown'));
      await advance(200);
      expect(shown()).toBe(back.message);
      await act(async () => press('click'));
      expect(shown()).toBe(back.message);
      // Control: a whole press on the notice now showing closes it.
      await act(async () => press('mousedown'));
      await act(async () => press('click'));
      expect(shown()).toBe(null);
    }

    if (scenario === 'single') {
      await add('seat', lost);
      await advance(seatHold - 1);
      expect(shown()).toBe(seatText);
      await advance(1);
      expect(shown()).toBe(null);
      // Bun has no React Native: the 240 ms press is the browser's; here the tap is immediate.
      await add('action', refused);
      expect(shown()).toBe(refused.message);
      await act(async () => document.querySelector('[data-testid="table-feedback"]').click());
      expect(shown()).toBe(null);
    }
  } finally {
    await act(async () => root.unmount());
    jest.useRealTimers();
  }
}
