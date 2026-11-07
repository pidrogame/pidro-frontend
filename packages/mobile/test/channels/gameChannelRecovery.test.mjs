import { expect, it, mock } from 'bun:test';

it('every rejoin replaces the full cached state and legal actions', async () => {
  await check('rejoin');
});

it('a timed-out game push reconnects, and a pending card retries with the same ID', async () => {
  await check('timeout');
});

it('answers liveness pings and announces backgrounding only while seated', async () => {
  await check('liveness');
});

it('sends current connection metadata on every join', async () => {
  await check('metadata');
});

it('fences and retries an untimed card using the snapshot turn cursor', async () => {
  await check('untimed');
});

it('back after a drop, says which card the bot played for you, and drops the kept tap quietly', async () => {
  await check('away');
});

it('back after a drop, says nothing when the card that left was the one you tapped', async () => {
  await check('away-own');
});

async function check(scenario) {
  if (!process.env.CHANNEL_RECOVERY_CHILD) {
    const child = Bun.spawnSync([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, CHANNEL_RECOVERY_CHILD: scenario },
    });
    expect(child.stderr.toString()).not.toContain('(fail)');
    expect(child.exitCode).toBe(0);
    return;
  }
  if (process.env.CHANNEL_RECOVERY_CHILD !== scenario) return;

  const { JSDOM } = await import('jsdom');
  const { act, createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const receipt = () => ({
    callbacks: {},
    receive(status, callback) {
      this.callbacks[status] = callback;
      return this;
    },
  });
  const joined = receipt();
  const pushes = [];
  const events = {};
  let joinRef = '1';
  const channel = {
    state: 'joined',
    joinRef: () => joinRef,
    join: () => joined,
    leave: () => {},
    on: (name, callback) => (events[name] = callback),
    onError: () => {},
    onClose: () => {},
    push: (event, payload) => {
      const reply = receipt();
      pushes.push({ event, payload, reply });
      return reply;
    },
  };
  const reconnects = [];
  let joinParams;
  let connection = { reason: 'unknown', network: 'wifi' };
  const socket = {
    channel: (_topic, params) => {
      joinParams = params;
      return channel;
    },
    connectionParams: () => () => connection,
    reconnect: () => reconnects.push('reconnected'),
  };
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
  const { useGameStore } = await import('@pidro/shared');
  const { useGameChannel, pushGameAction, sendCard } =
    await import('../../src/channels/hooks/useGameChannel.ts');
  const card = { rank: 14, suit: 'clubs' };
  const state = {
    game_instance_id: 'game',
    hand_number: 2,
    state_revision: 8,
    phase: 'playing',
    current_player: 'west',
    players: { west: { hand: [card, { rank: 12, suit: 'clubs' }] } },
  };
  const response = {
    role: 'player',
    position: 'west',
    game_state: state,
    game_instance_id: 'game',
    state_revision: 8,
    turn_event_seq: 77,
    legal_actions: [{ type: 'play_card', card }],
    turn_timer: {
      timer_id: 12,
      event_seq: 77,
      scope: 'seat',
      position: 'west',
      phase: 'playing',
      duration_ms: 20000,
      transition_delay_ms: 0,
      server_time: new Date().toISOString(),
    },
  };
  if (scenario === 'untimed') response.turn_timer = null;
  const notices = [];
  function Table() {
    useGameChannel({ roomCode: 'TEST', onSeatEvent: (notice) => notices.push(notice) });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(h(Table)));
    await act(async () => joined.callbacks.ok(response));
    if (scenario === 'metadata') {
      expect(typeof joinParams).toBe('function');
      expect(joinParams()).toMatchObject({
        reason: 'unknown',
        network: 'wifi',
        platform: 'android',
      });
      connection = { reason: 'network_lost', network: 'cellular' };
      expect(joinParams()).toMatchObject(connection);
    } else if (scenario === 'liveness') {
      await act(async () => events.ping({ id: 'ping-17' }));
      expect(pushes.at(-1).event).toBe('pong');
      expect(pushes.at(-1).payload).toEqual({ id: 'ping-17' });
      let drained = false;
      socket.beforeBackground(() => (drained = true));
      expect(pushes.at(-1).event).toBe('going_background');
      expect(pushes.at(-1).payload).toEqual({});
      expect(drained).toBe(false);
      pushes.at(-1).reply.callbacks.ok({});
      expect(drained).toBe(true);
      await act(async () => joined.callbacks.ok({ ...response, role: 'spectator' }));
      const before = pushes.length;
      socket.beforeBackground(() => {});
      expect(pushes).toHaveLength(before);
    } else if (scenario === 'away' || scenario === 'away-own') {
      // A♣ tapped, the reply lost; the bot that kept the seat played a card meanwhile.
      let pending;
      await act(async () => {
        pending = sendCard(card);
      });
      await act(async () => pushes.at(-1).reply.callbacks.timeout());
      const queen = { rank: 12, suit: 'clubs' };
      const played = scenario === 'away' ? queen : card;
      const kept = scenario === 'away' ? card : queen;
      const sent = pushes.length;
      joinRef = '2';
      await act(async () =>
        joined.callbacks.ok({
          ...response,
          game_state: {
            ...state,
            current_player: 'north',
            tricks: [{ cards: [{ player: 'west', card: played }], winner: 'west' }],
            current_trick: [],
            players: { west: { hand: [kept] } },
          },
          legal_actions: [],
        })
      );
      expect(notices.filter((notice) => notice.away)).toEqual(
        scenario === 'away' ? [{ away: { cards: [queen], out: false }, variant: 'warning' }] : []
      );
      // Quiet either way: no retry, and no "too late" from the kept tap.
      expect(pushes.slice(sent).filter(({ event }) => event === 'play_card')).toEqual([]);
      expect(await pending).toBe(scenario === 'away-own');
    } else if (scenario === 'rejoin') {
      await act(async () =>
        joined.callbacks.ok({
          ...response,
          game_state: { ...state, current_player: 'north' },
          legal_actions: [],
        })
      );
      expect(useGameStore.getState().serverState.current_player).toBe('north');
      expect(useGameStore.getState().legalActions).toEqual([]);
      expect(useGameStore.getState().youPositionAbs).toBe('west');
    } else {
      const control = pushGameAction('set_pace', { pace: 'normal' }).catch((e) => e.reason);
      await act(async () => pushes.at(-1).reply.callbacks.timeout());
      expect(await control).toBe('timeout');
      expect(reconnects).toHaveLength(1);
      await act(async () => events.turn_timer_cancelled({ timer_id: 12 }));
      expect(useGameStore.getState().turnTimer).toBeNull();
      let pending;
      await act(async () => {
        pending = sendCard(card);
      });
      const first = pushes.at(-1);
      expect(first.payload.game_instance_id).toBe('game');
      expect(first.payload.turn_event_seq).toBe(77);
      await act(async () => first.reply.callbacks.timeout());
      expect(reconnects).toHaveLength(2);
      const oldControl = pushGameAction('set_pace', { pace: 'normal' }).catch((e) => e.reason);
      const oldReply = pushes.at(-1).reply;
      joinRef = '2';
      await act(async () => joined.callbacks.ok(response));
      const retry = pushes.at(-1);
      expect(retry.event).toBe('play_card');
      expect(retry.payload.action_id).toBe(first.payload.action_id);
      expect(retry.payload.card).toEqual(card);
      expect(retry.payload.turn_event_seq).toBe(77);
      await act(async () => retry.reply.callbacks.ok({}));
      expect(await pending).toBe(true);
      await act(async () => oldReply.callbacks.timeout());
      expect(await oldControl).toBe('timeout');
      expect(reconnects).toHaveLength(2);
    }
  } finally {
    await act(async () => root.unmount());
    useGameStore.getState().reset();
    dom.window.close();
  }
}
