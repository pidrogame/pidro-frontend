import { Socket, Channel } from 'phoenix';
import type { PlatformConfig } from '../platform/types';

export type TokenGetter = () => string | null;

export interface PhoenixSocketOptions {
  config: PlatformConfig;
  getToken: TokenGetter;
}

export class PhoenixSocket {
  private socket: Socket | null = null;
  private tokenGetter: TokenGetter | null = null;
  private connectionRequested = false;
  private disconnecting = false;

  private reconnectDelay(tries: number) {
    const schedule = [500, 1000, 2000, 3000];
    return schedule[Math.max(0, Math.min(tries - 1, schedule.length - 1))] ?? 3000;
  }

  init({ config, getToken }: PhoenixSocketOptions) {
    if (this.socket) return this.socket;
    this.tokenGetter = getToken;

    const token = getToken();
    this.socket = new Socket(config.wsURL, {
      ...(token ? { authToken: token } : {}),
      heartbeatIntervalMs: 5_000,
      reconnectAfterMs: (tries: number) => this.reconnectDelay(tries),
      rejoinAfterMs: (tries: number) => this.reconnectDelay(tries),
    });

    return this.socket;
  }

  get(): Socket {
    if (!this.socket) {
      throw new Error('[Socket] Not initialized. Call init() first.');
    }
    return this.socket;
  }

  isInitialized(): boolean {
    return this.socket !== null;
  }

  connect() {
    this.connectionRequested = true;
    if (!this.socket || this.disconnecting) return;
    this.openConnection();
  }

  /** A known network change or lost reply must not wait for the heartbeat/backoff. */
  reconnect() {
    if (!this.connectionRequested || !this.socket || this.disconnecting) return;
    this.disconnect();
    this.connect();
  }

  private openConnection() {
    if (!this.socket) return;
    // Keep the credential Phoenix will use for its next automatic reconnect
    // current even while an existing connection intentionally stays open.
    (this.socket as Socket & { authToken?: string }).authToken =
      this.tokenGetter?.() ?? undefined;
    if (!this.socket.isConnected()) {
      this.socket.connect();
    }
  }

  disconnect() {
    this.connectionRequested = false;
    if (!this.socket || this.disconnecting) return;

    this.disconnecting = true;
    this.socket.disconnect(() => {
      this.disconnecting = false;
      if (this.connectionRequested) this.openConnection();
    });
  }

  channel(topic: string, params?: any): Channel {
    return this.get().channel(topic, params);
  }
}
