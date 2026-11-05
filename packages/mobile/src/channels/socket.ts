import { AppState, AppStateStatus } from 'react-native';
import { PhoenixSocket } from '@pidro/shared';
import { API_CONFIG } from '@/constants/config';
import { gameDiagnostics } from '@/diagnostics/buffer';
import { addNetworkStateListener, type NetworkState } from 'expo-network';

class MobilePhoenixSocket extends PhoenixSocket {
  private appState: AppStateStatus = AppState.currentState;
  private appStateSub?: { remove: () => void };
  private networkSub?: { remove: () => void };
  private network: NetworkState | null = null;
  private getToken: () => string | null = () => null;

  initMobile(getToken: () => string | null) {
    this.getToken = getToken;
    const socket = this.init({
      config: API_CONFIG,
      getToken,
    });

    this.setupAppStateListener();
    this.networkSub?.remove();
    this.networkSub = addNetworkStateListener((network) => {
      const previous = this.network;
      this.network = network;
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
        this.reconnect();
      }
    });
    return socket;
  }

  private setupAppStateListener() {
    this.appStateSub?.remove();
    this.appStateSub = AppState.addEventListener('change', (nextState) => {
      if (this.appState === nextState) return;
      this.appState = nextState;
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
        this.reconnect();
        this.connect();
      } else if (nextState === 'background') {
        this.disconnect();
      }
    });
  }
}

export const phoenixSocket = new MobilePhoenixSocket();
