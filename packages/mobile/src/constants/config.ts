import { Platform } from 'react-native';

/**
 * Application configuration constants
 */

const LOCALHOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

export const API_CONFIG = {
  baseURL: process.env.EXPO_PUBLIC_API_URL || `http://${LOCALHOST}:4000`,
  wsURL: process.env.EXPO_PUBLIC_WS_URL || `ws://${LOCALHOST}:4000/socket`,
  timeout: 10_000,
} as const;

export const STORAGE_KEYS = {
  auth: 'auth-storage',
  ageGate: 'age-gate-storage',
  installId: 'install-id:v1',
  guestCreationToken: 'guest-creation-token:v1',
  pendingInvite: 'pending-invite-storage',
  pendingFriendLink: 'pending-friend-link-storage',
  // A news post the player has seen is `news-seen:<post id>`; the welcome is the first.
  welcomeSeen: 'news-seen:welcome',
} as const;

export const APP_CONFIG = {
  name: 'Pidro',
  version: '3.2.0',
} as const;
