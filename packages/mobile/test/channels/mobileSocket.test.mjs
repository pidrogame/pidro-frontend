import { describe, expect, it, mock } from 'bun:test';

let onAppStateChange;
let onNetworkChange;
mock.module('expo-network', () => ({
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
  it('disconnects in background and reconnects an authenticated foreground session', () => {
    let token = 'token';
    let connectCalls = 0;
    let disconnectCalls = 0;
    let reconnectCalls = 0;

    phoenixSocket.initMobile(() => token);
    phoenixSocket.reconnect = () => {
      reconnectCalls++;
    };
    phoenixSocket.connect = () => {
      connectCalls += 1;
    };
    phoenixSocket.disconnect = () => {
      disconnectCalls += 1;
    };

    onAppStateChange('background');
    onAppStateChange('background');
    onAppStateChange('active');

    expect(disconnectCalls).toBe(1);
    expect(connectCalls).toBe(1);
    expect(reconnectCalls).toBe(1);
    onNetworkChange({ isConnected: false, type: 'NONE' });
    onNetworkChange({ isConnected: true, type: 'WIFI' });
    onNetworkChange({ isConnected: true, type: 'WIFI' });
    expect(reconnectCalls).toBe(2);
    onNetworkChange({ isConnected: true, type: 'CELLULAR' });
    expect(reconnectCalls).toBe(3);
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
