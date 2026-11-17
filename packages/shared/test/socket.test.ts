import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { PhoenixSocket } from '../src/channels/socket';

describe('PhoenixSocket connection lifecycle', () => {
  it('uses a ten-second heartbeat', () => {
    const client = new PhoenixSocket();
    const socket = client.init({
      config: { apiURL: 'https://example.test', wsURL: 'wss://example.test/socket' },
      getToken: () => 'token',
    }) as ReturnType<PhoenixSocket['init']> & { heartbeatIntervalMs: number };
    expect(socket.heartbeatIntervalMs).toBe(10_000);
  });

  it('reports heartbeat timeout even when the dead transport closes without a reason', () => {
    const client = new PhoenixSocket();
    const socket = client.init({
      config: { apiURL: 'https://example.test', wsURL: 'wss://example.test/socket' },
      getToken: () => 'token',
    }) as ReturnType<PhoenixSocket['init']> & {
      pendingHeartbeatRef: string | null;
      heartbeatTimeout: () => void;
      teardown: () => void;
      onConnClose: (event: { code: number; reason: string }) => void;
    };
    socket.teardown = () => socket.onConnClose({ code: 1000, reason: '' });
    socket.pendingHeartbeatRef = 'lost-heartbeat';
    socket.heartbeatTimeout();
    expect(client.reconnectReason).toBe('heartbeat_timeout');
  });

  it('refreshes the automatic reconnect token without dropping a live socket', () => {
    let token = 'guest-token';
    const client = new PhoenixSocket();
    const socket = client.init({
      config: { apiURL: 'https://example.test', wsURL: 'wss://example.test/socket' },
      getToken: () => token,
    }) as ReturnType<PhoenixSocket['init']> & { authToken?: string };
    let connectCalls = 0;
    socket.isConnected = () => true;
    socket.connect = () => {
      connectCalls += 1;
    };

    token = 'saved-token';
    client.connect();

    expect(socket.authToken).toBe('saved-token');
    expect(connectCalls).toBe(0);
  });

  it('reconnects after an in-flight disconnect finishes', () => {
    const client = new PhoenixSocket();
    const socket = client.init({
      config: { apiURL: 'https://example.test', wsURL: 'wss://example.test/socket' },
      getToken: () => 'token',
    });
    let finishDisconnect: (() => void) | undefined;
    let connectCalls = 0;
    let connected = true;

    socket.isConnected = () => connected;
    socket.disconnect = (callback?: () => void) => {
      finishDisconnect = () => {
        connected = false;
        callback?.();
      };
    };
    socket.connect = () => {
      connectCalls += 1;
      connected = true;
    };

    client.disconnect();
    client.connect();

    expect(connectCalls).toBe(0);
    expect(finishDisconnect).toBeDefined();

    finishDisconnect?.();

    expect(connectCalls).toBe(1);
  });

  it('does not reconnect after a later disconnect intent', () => {
    const client = new PhoenixSocket();
    const socket = client.init({
      config: { apiURL: 'https://example.test', wsURL: 'wss://example.test/socket' },
      getToken: () => 'token',
    });
    let finishDisconnect: (() => void) | undefined;
    let connectCalls = 0;
    let connected = true;

    socket.isConnected = () => connected;
    socket.disconnect = (callback?: () => void) => {
      finishDisconnect = () => {
        connected = false;
        callback?.();
      };
    };
    socket.connect = () => {
      connectCalls += 1;
      connected = true;
    };

    client.disconnect();
    client.connect();
    client.disconnect();
    finishDisconnect?.();

    expect(connectCalls).toBe(0);
  });
});

// Phoenix stays real; only the WebSocket under it is faked. A dead link takes
// bytes and answers nothing, and its close handshake may never complete.
class FakeWebSocket {
  static made: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = 'arraybuffer';
  bufferedAmount = 0;
  closeAfterMs: number | null = 80;
  dead = false;
  joins: string[] = [];
  onopen = () => {};
  onclose = (_event: unknown) => {};
  onerror = (_event: unknown) => {};
  onmessage = (_event: { data: string }) => {};

  constructor() {
    FakeWebSocket.made.push(this);
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen();
    }, 5);
  }

  send(raw: string) {
    const [joinRef, ref, topic, event] = JSON.parse(raw);
    if (event === 'phx_join') this.joins.push(topic);
    if (this.dead) return;
    // Phoenix answers a push for a topic this connection never joined like this.
    const known = topic === 'phoenix' || this.joins.includes(topic);
    const status = known ? 'ok' : 'error';
    const response = known ? {} : { reason: 'unmatched topic' };
    setTimeout(() => {
      if (this.readyState !== 1) return;
      const reply = [joinRef, ref, topic, 'phx_reply', { status, response }];
      this.onmessage({ data: JSON.stringify(reply) });
    }, 1);
  }

  close() {
    this.readyState = 2;
    const after = this.closeAfterMs;
    if (after === null) return;
    setTimeout(() => {
      this.readyState = 3;
      this.onclose({ code: 1000 });
    }, after);
  }
}

describe('PhoenixSocket channels after a deliberate teardown', () => {
  const realWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    jest.useFakeTimers();
    FakeWebSocket.made = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.WebSocket = realWebSocket;
  });

  type Link = { dead: boolean; closesAfterMs: number | null; buffered?: number };

  function atTable(link: Link, teardown: (client: PhoenixSocket) => void) {
    const client = new PhoenixSocket();
    client.init({
      config: { apiURL: 'https://example.test', wsURL: 'wss://example.test/socket' },
      getToken: () => 'token',
    });
    client.connect();
    const channel = client.channel('game:TEST', {});
    let joined = 0;
    channel.join().receive('ok', () => joined++);
    jest.advanceTimersByTime(60);

    const [old] = FakeWebSocket.made;
    old!.dead = link.dead;
    old!.closeAfterMs = link.closesAfterMs;
    old!.bufferedAmount = link.buffered ?? 0;
    teardown(client);

    let reply = 'none';
    channel
      .push('play_card', { card: { rank: 14, suit: 'spades' } }, 500)
      .receive('ok', () => (reply = 'ok'))
      .receive('error', (error: { reason?: string }) => (reply = `error: ${error.reason}`))
      .receive('timeout', () => (reply = 'timeout'));
    jest.advanceTimersByTime(10);

    const result = {
      transports: FakeWebSocket.made.length,
      oldJoins: old!.joins,
      newJoins: FakeWebSocket.made[1]?.joins,
      joined,
      reply,
    };
    client.disconnect();
    jest.advanceTimersByTime(3500);
    return result;
  }

  const reconnect = (client: PhoenixSocket) => {
    client.reconnect('push_timeout');
    // Phoenix gives the old transport up to 1.5 s to send what it buffered, then 1.5 s
    // to confirm its close.
    jest.advanceTimersByTime(3500);
  };
  const background = (client: PhoenixSocket) => {
    client.disconnect();
    jest.advanceTimersByTime(3500);
    client.connect();
    jest.advanceTimersByTime(500);
  };
  // The channel rejoins exactly once, on the new connection and never on the old one,
  // and a push sent after lands.
  const rejoinedOnce = {
    transports: 2,
    oldJoins: ['game:TEST'],
    newJoins: ['game:TEST'],
    joined: 2,
    reply: 'ok',
  };

  it('rejoins after reconnect() when the old transport closes promptly', () => {
    expect(atTable({ dead: false, closesAfterMs: 80 }, reconnect)).toEqual(rejoinedOnce);
  });

  it('rejoins after reconnect() when the old transport closes too late', () => {
    expect(atTable({ dead: true, closesAfterMs: 2000 }, reconnect)).toEqual(rejoinedOnce);
  });

  it('rejoins after reconnect() when the old transport never closes', () => {
    expect(atTable({ dead: true, closesAfterMs: null }, reconnect)).toEqual(rejoinedOnce);
  });

  it('rejoins after background and foreground when the old transport closes promptly', () => {
    expect(atTable({ dead: false, closesAfterMs: 80 }, background)).toEqual(rejoinedOnce);
  });

  it('rejoins after background and foreground when the old transport never closes', () => {
    expect(atTable({ dead: true, closesAfterMs: null }, background)).toEqual(rejoinedOnce);
  });

  it('rejoins only on the new connection when unsent bytes hold the dead one open', () => {
    // Browsers report bufferedAmount; Phoenix then waits before it even starts the close.
    expect(atTable({ dead: true, closesAfterMs: null, buffered: 100 }, reconnect)).toEqual(
      rejoinedOnce
    );
  });
});
