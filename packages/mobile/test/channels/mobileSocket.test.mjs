import { describe, expect, it, mock } from 'bun:test';

let onAppStateChange;
let onNetworkChange;
mock.module('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true, type: 'WIFI' }),
  addNetworkStateListener: (listener) => {
    onNetworkChange = listener;
    return { remove: () => {} };
  },
}));

mock.module('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_event, listener) => {
      onAppStateChange = listener;
      return { remove: () => {} };
    },
  },
  Platform: { OS: 'ios' },
}));

const { phoenixSocket } = await import('../../src/channels/socket.ts');

describe('mobile socket AppState lifecycle', () => {
  it('keeps recovery reasons per connection for delayed joins, not later new channels', () => {
    const socket = phoenixSocket.initMobile(() => 'token');
    const open = () => socket.stateChangeCallbacks.open.forEach(([, callback]) => callback());
    open();
    const lobby = phoenixSocket.connectionParams();
    const game = phoenixSocket.connectionParams();
    phoenixSocket.reconnectReason = 'backgrounded';
    open();
    expect(lobby().reason).toBe('backgrounded');
    expect(phoenixSocket.connectionParams()().reason).toBe('unknown');
    expect(game().reason).toBe('backgrounded');
    open();
    expect(lobby().reason).toBe('unknown');
    expect(game().reason).toBe('unknown');
  });

  it('allows actual LongPoll batching before background disconnect and fences a late drain', async () => {
    const { LongPoll } = await import('phoenix');
    const originalPoll = LongPoll.prototype.poll;
    LongPoll.prototype.poll = () => {};
    const transport = new LongPoll('http://example.test/socket/longpoll');
    LongPoll.prototype.poll = originalPoll;
    transport.poll = () => {};
    let acknowledge;
    const posted = [];
    transport.ajax = (_method, _headers, body, _timeout, reply) => {
      posted.push(body);
      acknowledge = () => reply({ status: 200 });
    };
    phoenixSocket.initMobile(() => 'token');
    const disconnect = phoenixSocket.disconnect;
    const reconnect = phoenixSocket.reconnect;
    const connect = phoenixSocket.connect;
    let closes = 0;
    phoenixSocket.disconnect = () => {
      closes++;
      transport.close();
    };
    phoenixSocket.reconnect = () => {};
    phoenixSocket.connect = () => {};
    let drained;
    phoenixSocket.beforeBackground = (done) => {
      drained = done;
      transport.send('going_background');
    };
    try {
      onAppStateChange('background');
      await Bun.sleep(20);
      expect(posted).toEqual(['going_background']);
      expect(closes).toBe(0);
      acknowledge();
      drained();
      expect(closes).toBe(1);
      onAppStateChange('active');
      onAppStateChange('background');
      onAppStateChange('active');
      drained();
      await Bun.sleep(550);
      expect(closes).toBe(1);
      onAppStateChange('background');
      const socket = phoenixSocket.get();
      const previousTransport = socket.conn;
      socket.conn = {};
      await Bun.sleep(550);
      expect(closes).toBe(2);
      socket.conn = previousTransport;
      onAppStateChange('active');
    } finally {
      onAppStateChange('active');
      transport.close();
      phoenixSocket.disconnect = disconnect;
      phoenixSocket.reconnect = reconnect;
      phoenixSocket.connect = connect;
      phoenixSocket.beforeBackground = undefined;
      phoenixSocket.reconnectReason = 'unknown';
    }
  });

  it('disconnects in background and reconnects an authenticated foreground session', async () => {
    let token = 'token';
    let connectCalls = 0;
    let disconnectCalls = 0;
    let reconnectCalls = 0;
    const order = [];

    phoenixSocket.initMobile(() => token);
    await Promise.resolve();
    expect(phoenixSocket.connectionInfo()).toEqual({ reason: 'unknown', network: 'wifi' });
    phoenixSocket.beforeBackground = (done) => {
      order.push('background');
      done();
    };
    phoenixSocket.reconnect = (reason) => {
      phoenixSocket.reconnectReason = reason;
      reconnectCalls++;
    };
    phoenixSocket.connect = () => {
      connectCalls += 1;
    };
    phoenixSocket.disconnect = () => {
      order.push('disconnect');
      disconnectCalls += 1;
    };

    onAppStateChange('background');
    onAppStateChange('background');
    onAppStateChange('active');

    expect(disconnectCalls).toBe(1);
    expect(connectCalls).toBe(1);
    expect(reconnectCalls).toBe(1);
    expect(order).toEqual(['background', 'disconnect']);
    expect(phoenixSocket.connectionInfo().reason).toBe('backgrounded');
    onNetworkChange({ isConnected: false, type: 'NONE' });
    expect(phoenixSocket.connectionInfo()).toEqual({ reason: 'network_lost', network: 'none' });
    onNetworkChange({ isConnected: true, type: 'WIFI' });
    onNetworkChange({ isConnected: true, type: 'WIFI' });
    expect(reconnectCalls).toBe(2);
    onNetworkChange({ isConnected: true, type: 'CELLULAR' });
    expect(reconnectCalls).toBe(3);
    expect(phoenixSocket.connectionInfo()).toEqual({ reason: 'network_lost', network: 'cellular' });
    onNetworkChange({ isConnected: true, isInternetReachable: false, type: 'CELLULAR' });
    expect(reconnectCalls).toBe(3);
    onNetworkChange({ isConnected: true, isInternetReachable: true, type: 'CELLULAR' });
    expect(reconnectCalls).toBe(4);

    token = null;
    onAppStateChange('background');
    onAppStateChange('active');

    expect(disconnectCalls).toBe(2);
    expect(connectCalls).toBe(1);
    onNetworkChange({ isConnected: false });
    onNetworkChange({ isConnected: true });
    expect(reconnectCalls).toBe(4);
  });
});
