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
  const intent = pendingPlay({
    card,
    position: 'west',
    state,
    send: () => new Promise((resolve, reject) => replies.push({ resolve, reject })),
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
  expect(finished).toBe(false);
  intent.rejoin();
  intent.rejoin();
  replies[2].reject({ reason: 'not_your_turn' });
  replies[3].resolve();
  expect(await intent.promise).toBe(true);
  intent.rejoin();
  expect(replies).toHaveLength(4);
});

// PID-446: Phoenix answers a push on a topic this connection never joined like this.
it('keeps the card through an unmatched topic, sends it once on rejoin, and still ends on a refusal', async () => {
  for (const answer of ['unmatched', 'late', 'refused']) {
    const replies = [];
    const intent = pendingPlay({
      card,
      position: 'west',
      state,
      send: () => new Promise((resolve, reject) => replies.push({ resolve, reject })),
    });
    let outcome = 'pending';
    intent.promise.then(
      (accepted) => (outcome = accepted),
      (error) => (outcome = error.reason)
    );
    intent.rejoin();
    if (answer === 'unmatched') replies[0].reject({ reason: 'unmatched topic' });
    if (answer === 'late')
      replies[0].reject({ reason: 'Not your turn', error_code: 'not_your_turn' });
    if (answer === 'refused') replies[0].reject({ reason: 'illegal_card' });
    await Promise.resolve();
    await Promise.resolve();
    expect(outcome).toBe(
      answer === 'unmatched' ? 'pending' : answer === 'late' ? 'too_late' : 'illegal_card'
    );
    intent.rejoin();
    expect(replies).toHaveLength(answer === 'unmatched' ? 2 : 1);
    if (answer !== 'unmatched') continue;
    replies[1].resolve();
    expect(await intent.promise).toBe(true);
    intent.rejoin();
    expect(replies).toHaveLength(2);
  }
});

it('refuses explicitly, clears a moot revision, and never replays into the next hand', async () => {
  for (const outcome of ['refused', 'late', 'played', 'turn', 'hand', 'trick', 'cancel']) {
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
    });
    const result = intent.promise.catch((error) => error.reason);
    intent.rejoin();
    intent.observe({ ...state, state_revision: 9 });
    if (outcome === 'refused') reject({ reason: 'illegal_card' });
    // The server's stale-turn answer: the client sent on its turn, so the turn moved on.
    if (outcome === 'late') reject({ reason: 'Not your turn', error_code: 'not_your_turn' });
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
            : 'too_late'
    );
    intent.rejoin();
    expect(pushes).toBe(1);
  }
});

// PID-460: the server answers `ok` first and sends the state that places the card after it.
it('a refusal before paint cannot lock every later tap; an ok keeps the card out until its state', async () => {
  if (!process.env.PENDING_TAP_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, PENDING_TAP_CHILD: '1' },
    });
    expect(child.stderr.toString()).not.toContain('(fail)');
    expect(child.exitCode).toBe(0);
    return;
  }
  const { JSDOM } = await import('jsdom');
  const { act, createElement: h, useState } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
  });
  let sounds = 0;
  mock.module('react-native-reanimated', () => ({ useReducedMotion: () => true }));
  mock.module('../../src/game/sounds.ts', () => ({ play: () => sounds++ }));
  const { usePlayPresentation } = await import('../../src/game/canvas/usePlayPresentation.ts');
  const { buildTableModel } = await import('../../src/game/canvas/tableModel.ts');
  const card = { rank: 14, suit: 'clubs' };
  const refused = { rank: 12, suit: 'clubs' };
  const next = { rank: 13, suit: 'clubs' };
  const players = [{ absolutePosition: 'west', relativePosition: 'south', isYou: true }];
  const table = (hand, turn, trick = []) =>
    buildTableModel({
      phase: 'playing',
      trumpSuit: 'clubs',
      players,
      yourHand: hand,
      yourCardCount: hand.length,
      currentTrick: trick,
      tricks: [],
      legalActions: turn === 'south' ? hand.map((c) => ({ type: 'play_card', card: c })) : [],
      currentTurnRelative: turn,
      canPlay: turn === 'south',
      getCardCountForPlayer: () => hand.length,
    });
  let calls = 0;
  let view;
  let serve;
  let reply;
  const send = () => {
    calls++;
    return new Promise((resolve) => (reply = resolve));
  };
  function Hand() {
    const [source, setSource] = useState(() => table([card, refused], 'south'));
    serve = setSource;
    view = usePlayPresentation(source, send);
    return null;
  }
  const tap = (c) =>
    act(async () => {
      view.playCard(c);
      await Promise.resolve();
    });
  const answer = (accepted) =>
    act(async () => {
      reply(accepted);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const out = () =>
    !view.model.yourHand.some((held) => held.card.rank === card.rank) &&
    view.model.playedCards.south?.length === 1;
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(h(Hand)));
    // Refused before paint: back in the hand, and the next tap is sent.
    await act(async () => {
      view.playCard(refused);
      reply(false);
      await Promise.resolve();
    });
    expect(calls).toBe(1);
    expect(view.model.yourHand).toHaveLength(2);
    await tap(refused);
    expect(calls).toBe(2);
    await answer(false);

    // Accepted: `ok`, then the state 300 ms later. The card never goes back.
    calls = 0;
    sounds = 0;
    await tap(card);
    expect(out()).toBe(true);
    await answer(true);
    expect(out()).toBe(true);
    await tap(card);
    expect(calls).toBe(1);
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(out()).toBe(true);
    await act(async () => serve(table([refused], 'east', [{ player: 'west', card }])));
    expect(out()).toBe(true);
    expect(view.model.playedCards.south[0].key).toStartWith('trick-0-');
    expect(sounds).toBe(1);
    // Your next turn takes the next tap.
    await act(async () => serve(table([refused, next], 'south', [{ player: 'west', card }])));
    await tap(next);
    expect(calls).toBe(2);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
