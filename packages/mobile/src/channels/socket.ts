import { AppState, AppStateStatus } from 'react-native';
import { PhoenixSocket } from '@pidro/shared';
import { API_CONFIG } from '@/constants/config';
import { gameDiagnostics } from '@/diagnostics/buffer';
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';

class MobilePhoenixSocket extends PhoenixSocket {
  private appState: AppStateStatus = AppState.currentState;
  private appStateSub?: { remove: () => void };
  private networkSub?: { remove: () => void };
  private network: NetworkState | null = null;
  private getToken: () => string | null = () => null;
  private backgroundGeneration = 0;
  beforeBackground?: (done: () => void) => void;

  connectionParams() {
    let generation = this.connectionGeneration;
    let reason: PhoenixSocket['reconnectReason'] = 'unknown';
    return () => {
      if (generation !== this.connectionGeneration) {
        generation = this.connectionGeneration;
        reason = this.connectionReason;
      }
      return { ...this.connectionInfo(), reason };
    };
  }

  connectionInfo() {
    const state = this.network;
    const type = state?.type?.toLowerCase();
    const network =
      state?.isConnected === false || state?.isInternetReachable === false || type === 'none'
        ? 'none'
        : type === 'wifi' || type === 'cellular'
          ? type
          : 'unknown';
    return { reason: this.reconnectReason, network };
  }

  initMobile(getToken: () => string | null) {
    this.getToken = getToken;
    const socket = this.init({
      config: API_CONFIG,
      getToken,
    });

    this.setupAppStateListener();
    this.networkSub?.remove();
    void getNetworkStateAsync()
      .then((network) => {
        if (!this.network) this.network = network;
      })
      .catch(() => {});
    this.networkSub = addNetworkStateListener((network) => {
      const previous = this.network;
      this.network = network;
      if (network.isConnected === false || network.isInternetReachable === false)
        this.reconnectReason = 'network_lost';
      if (
        this.appState !== 'active' ||
        !this.getToken() ||
        !network.isConnected ||
        network.isInternetReachable === false
      )
        return;
      if (
        previous &&
        (!previous.isConnected ||
          previous.isInternetReachable === false ||
          previous.type !== network.type)
      ) {
        this.reconnect('network_lost');
      }
    });
    return socket;
  }

  private setupAppStateListener() {
    this.appStateSub?.remove();
    this.appStateSub = AppState.addEventListener('change', (nextState) => {
      if (this.appState === nextState) return;
      this.appState = nextState;
      const generation = ++this.backgroundGeneration;
      gameDiagnostics.record({
        type: 'lifecycle',
        code:
          nextState === 'active'
            ? 'foreground'
            : nextState === 'background'
              ? 'background'
              : 'paused',
        action: 'none',
      });

      if (nextState === 'active' && this.getToken()) {
        this.reconnect(this.reconnectReason);
        this.connect();
      } else if (nextState === 'background') {
        this.reconnectReason = 'backgrounded';
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          if (generation === this.backgroundGeneration) this.disconnect();
        };
        // LongPoll batches pushes on the next tick; give its acknowledgement
        // a bounded chance to arrive before tearing down the transport.
        const timeout = setTimeout(finish, 500);
        if (this.beforeBackground) this.beforeBackground(finish);
        else finish();
      }
    });
  }
}

export const phoenixSocket = new MobilePhoenixSocket();
