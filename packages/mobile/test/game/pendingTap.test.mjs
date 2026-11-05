import { expect, it, mock } from 'bun:test';
import { pendingPlay } from '../../src/features/game/pendingPlay.ts';

const card = { rank: 14, suit: 'clubs' };
const state = {
  game_instance_id: 'game',
  state_revision: 8,
  hand_number: 2,
  phase: 'playing',
  current_player: 'west',
  players: { west: { hand: [card, { rank: 12, suit: 'clubs' }] } },
};

it('retains an unanswered intent, retries on rejoin, accepts once and ignores late failures', async () => {
  const replies = [];
  let reconnects = 0;
  const intent = pendingPlay({
    card,
    position: 'west',
    state,
    send: () => new Promise((resolve, reject) => replies.push({ resolve, reject })),
    reconnect: () => reconnects++,
  });
  let finished = false;
  intent.promise.then(() => (finished = true));
  intent.rejoin();
  replies[0].reject({ reason: 'disconnected' });
  await Promise.resolve();
  expect(finished).toBe(false);
  intent.rejoin();
  replies[1].reject({ reason: 'timeout' });
  await Promise.resolve();
  expect(reconnects).toBe(1);
  expect(finished).toBe(false);
  intent.rejoin();
  intent.rejoin();
  replies[2].reject({ reason: 'not_your_turn' });
  replies[3].resolve();
  expect(await intent.promise).toBe(true);
  intent.rejoin();
  expect(replies).toHaveLength(4);
});

it('refuses explicitly, clears a moot revision, and never replays into the next hand', async () => {
  for (const outcome of ['refused', 'played', 'turn', 'hand', 'trick', 'cancel']) {
    let reject;
    let pushes = 0;
    const intent = pendingPlay({
      card,
      position: 'west',
      state,
      send: () => {
        pushes++;
        return new Promise((_, no) => (reject = no));
      },
      reconnect: () => {},
    });
    const result = intent.promise.catch((error) => error.reason);
    intent.rejoin();
    intent.observe({ ...state, state_revision: 9 });
    if (outcome === 'refused') reject({ reason: 'illegal_card' });
    if (outcome === 'played')
      intent.observe({
        ...state,
        state_revision: 10,
        current_player: 'north',
        players: { west: { hand: [{ rank: 12, suit: 'clubs' }] } },
      });
    if (outcome === 'turn')
      intent.observe({ ...state, state_revision: 10, current_player: 'north' });
    if (outcome === 'hand') intent.observe({ ...state, hand_number: 3 });
    if (outcome === 'trick') intent.observe({ ...state, tricks: [{ number: 1 }] });
    if (outcome === 'cancel') intent.cancel();
    expect(await result).toBe(
      outcome === 'played'
        ? true
        : outcome === 'cancel'
          ? false
          : outcome === 'refused'
            ? 'illegal_card'
            : 'not_your_turn'
    );
    intent.rejoin();
    expect(pushes).toBe(1);
  }
});

it('a reply before paint cannot lock every later tap', async () => {
  if (!process.env.PENDING_TAP_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, PENDING_TAP_CHILD: '1' },
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
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
  });
  mock.module('react-native-reanimated', () => ({ useReducedMotion: () => true }));
  mock.module('../../src/game/sounds.ts', () => ({ play: () => {} }));
  const { usePlayPresentation } = await import('../../src/game/canvas/usePlayPresentation.ts');
  const { buildTableModel } = await import('../../src/game/canvas/tableModel.ts');
  const card = { rank: 14, suit: 'clubs' };
  const source = buildTableModel({
    phase: 'playing',
    trumpSuit: 'clubs',
    players: [],
    yourHand: [card],
    yourCardCount: 1,
    currentTrick: [],
    tricks: [],
    legalActions: [{ type: 'play_card', card }],
    currentTurnRelative: 'south',
    canPlay: true,
    getCardCountForPlayer: () => 1,
  });
  let calls = 0;
  let table;
  let accepted = false;
  const send = () => {
    calls++;
    return Promise.resolve(accepted);
  };
  function Hand() {
    table = usePlayPresentation(source, send);
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(h(Hand)));
    for (const reply of [false, true]) {
      accepted = reply;
      calls = 0;
      await act(async () => {
        table.playCard(card);
        await Promise.resolve();
      });
      expect(calls).toBe(1);
      expect(table.model.yourHand).toHaveLength(1);
      await act(async () => {
        table.playCard(card);
        await Promise.resolve();
      });
      expect(calls).toBe(2);
    }
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
