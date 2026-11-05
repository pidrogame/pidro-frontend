import { describe, expect, it } from 'bun:test';
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
