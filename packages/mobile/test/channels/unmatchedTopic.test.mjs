import { expect, it, jest, mock } from 'bun:test';

// PID-446: the server no longer has this connection on the table, but the channel still
// says joined. Phoenix stays real; only the WebSocket under it is faked (PID-445's fake).
it('an unmatched topic answer rejoins the table once and plays the tapped card', async () => {
  await check('unmatched');
});

it('an unmatched topic answer rejoins once, and a turn that moved on meanwhile is too late', async () => {
  await check('moved-on');
});

it('a refusal from a server that has the table ends the card and rejoins nothing', async () => {
  await check('refused');
});

async function check(scenario) {
  if (!process.env.UNMATCHED_TOPIC_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, UNMATCHED_TOPIC_CHILD: scenario },
    });
    expect(child.stderr.toString()).not.toContain('(fail)');
    expect(child.exitCode).toBe(0);
    return;
  }
  if (process.env.UNMATCHED_TOPIC_CHILD !== scenario) return;

  const { FakeWebSocket } = await import('../../../shared/test/fakeWebSocket.ts');
  const { JSDOM } = await import('jsdom');
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>');
  dom.window.WebSocket = FakeWebSocket;
  Object.assign(globalThis, {
    WebSocket: FakeWebSocket,
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  jest.useFakeTimers();

  const { PhoenixSocket, useGameStore } = await import('@pidro/shared');
  const socket = new PhoenixSocket();
  socket.init({
    config: { apiURL: 'https://example.test', wsURL: 'wss://example.test/socket' },
    getToken: () => 'token',
  });
  socket.connectionParams = () => () => ({ reason: 'unknown', network: 'wifi' });
  mock.module('../../src/channels/socket.ts', () => ({ phoenixSocket: socket }));
  mock.module('../../src/bootstrap/realtime.ts', () => ({ initRealtime: () => {} }));
  mock.module('../../src/stores/auth.ts', () => ({
    authStore: { getState: () => ({ user: { id: 'player' } }) },
  }));
  mock.module('../../src/stores/settings.ts', () => ({
    useSettingsStore: (select) => select({ pace: 'normal', hydrated: false }),
  }));
  mock.module('../../src/diagnostics/metadata.ts', () => ({
    diagnosticMetadata: { app_version: '3.2.3', build: '1', platform: 'android' },
  }));
  mock.module('react-native', () => ({ unstable_batchedUpdates: (run) => run() }));
  const { useGameChannel, sendCard, pushGameAction } =
    await import('../../src/channels/hooks/useGameChannel.ts');
  const { gameDiagnostics } = await import('../../src/diagnostics/buffer.ts');

  const card = { rank: 14, suit: 'clubs' };
  const state = {
    game_instance_id: 'game',
    hand_number: 2,
    state_revision: 8,
    phase: 'playing',
    current_player: 'west',
    players: { west: { hand: [card, { rank: 12, suit: 'clubs' }] } },
  };
  const seated = { role: 'player', position: 'west', game_state: state, legal_actions: [] };

  socket.connect();
  const [ws] = FakeWebSocket.made;
  ws.respond = (_topic, event) => (event === 'phx_join' ? seated : {});
  const refusal = { reason: 'Not your turn', error_code: 'not_your_turn' };
  // What went over the wire, and every reply that came back on it.
  const sent = [];
  const answers = [];
  const send = ws.send.bind(ws);
  ws.send = (raw) => {
    const [, , topic, event, payload] = JSON.parse(raw);
    if (topic !== 'phoenix') sent.push({ event, actionId: payload.action_id });
    if (scenario !== 'refused' || event !== 'play_card') return send(raw);
    const [joinRef, ref] = JSON.parse(raw);
    const reply = [joinRef, ref, topic, 'phx_reply', { status: 'error', response: refusal }];
    setTimeout(() => ws.onmessage({ data: JSON.stringify(reply) }), 1);
  };
  const deliver = ws.onmessage;
  ws.onmessage = (message) => {
    const [, , topic, , reply] = JSON.parse(message.data);
    if (topic !== 'phoenix')
      answers.push(reply.response.error_code ?? reply.response.reason ?? reply.status);
    deliver(message);
  };

  function Table() {
    useGameChannel({ roomCode: 'TEST' });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  const advance = (ms) => act(async () => jest.advanceTimersByTime(ms));
  try {
    await act(async () => root.render(h(Table)));
    await advance(60);
    expect(useGameStore.getState().isChannelJoined).toBe(true);
    expect(sent).toEqual([{ event: 'phx_join' }]);

    if (scenario === 'refused') {
      // Control: the server has the table and refuses the card. Nothing rejoins.
      const outcome = await act(async () => {
        const pending = sendCard(card).catch((error) => error.reason);
        jest.advanceTimersByTime(2);
        return pending;
      });
      expect(answers).toEqual(['ok', 'not_your_turn']);
      expect(outcome).toBe('too_late');
      await advance(5000);
      expect(sent.map(({ event }) => event)).toEqual(['phx_join', 'play_card']);
      expect(useGameStore.getState()).toMatchObject({ isChannelJoined: true, isRejoining: false });
      const events = gameDiagnostics.snapshot().events.map(({ type, code }) => `${type} ${code}`);
      expect(events).toContain('push not_your_turn');
      expect(events).not.toContain('connection reconnecting');
      return;
    }

    // The server loses this table; the channel still says joined. A card and a pace push
    // are in flight together, so two unmatched answers arrive from the same join.
    ws.joins = [];
    let pending;
    let outcome = 'pending';
    await act(async () => {
      pending = sendCard(card);
      pending.then(
        (accepted) => (outcome = accepted),
        (error) => (outcome = error.reason)
      );
    });
    const pace = pushGameAction('set_pace', { pace: 'normal' }).catch((error) => error.reason);
    await advance(2);
    expect(answers).toEqual(['ok', 'unmatched topic', 'unmatched topic']);
    expect(await pace).toBe('unmatched topic');
    expect(outcome).toBe('pending');
    expect(useGameStore.getState()).toMatchObject({ isChannelJoined: false, isRejoining: true });

    if (scenario === 'moved-on') {
      // The rejoin finds the turn gone: the existing "too late" path, and no card resent.
      ws.respond = (_topic, event) =>
        event === 'phx_join'
          ? { ...seated, game_state: { ...state, state_revision: 9, current_player: 'north' } }
          : {};
      await advance(600);
      expect(ws.joins).toEqual(['game:TEST']);
      expect(sent.slice(3).map(({ event }) => event)).toEqual(['phx_join']);
      expect(outcome).toBe('too_late');
      await advance(5000);
      expect(sent).toHaveLength(4);
      return;
    }

    // Phoenix's own rejoin, on the same connection, then the card goes again once.
    await advance(600);
    expect(FakeWebSocket.made).toHaveLength(1);
    expect(ws.joins).toEqual(['game:TEST']);
    const [, firstCard, , rejoin, retry, ...rest] = sent;
    expect(rejoin).toEqual({ event: 'phx_join' });
    expect(retry).toEqual({ event: 'play_card', actionId: firstCard.actionId });
    expect(rest).toEqual([]);
    expect(answers.slice(3)).toEqual(['ok', 'ok']);
    expect(outcome).toBe(true);
    expect(useGameStore.getState()).toMatchObject({ isChannelJoined: true, isRejoining: false });

    // A table problem report shows the server's answer and the reconnect it caused.
    const events = gameDiagnostics
      .snapshot()
      .events.map(({ type, code, action }) => [type, code, action].join(' '));
    expect(events).toContain('push disconnected play_card');
    expect(events).toContain('push disconnected set_pace');
    expect(events.filter((event) => event === 'connection reconnecting reconnect')).toHaveLength(1);
    // Nothing is pending and nothing else is sent while the table is quiet.
    await advance(5000);
    expect(sent).toHaveLength(5);
  } finally {
    await act(async () => root.unmount());
    socket.disconnect();
    jest.useRealTimers();
    useGameStore.getState().reset();
    dom.window.close();
  }
}
