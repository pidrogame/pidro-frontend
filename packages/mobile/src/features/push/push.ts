/**
 * Push over expo-notifications. This build never asks for permission (PID-317 picks the
 * moment); it only registers an install that already allows notifications, and forgets
 * the token on sign-out. A server without the endpoint yet answers 404: logged, not shown.
 */
import { Linking, Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';
import type { PermissionStatus } from 'expo-notifications';
import { pushApi } from '@/api/push';
import { APP_CONFIG } from '@/constants/config';
import { getInstallId } from '@/features/invites/installId';
import { FOREGROUND_PRESENTATION, handlePushResponse } from './handlePushResponse';

// Expo Go has no remote push since SDK 53; a development build does.
const native =
  (Platform.OS === 'ios' || Platform.OS === 'android') &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
// The token this start registered, and for whom: once per start and player.
let registered: { token: string; userId: string } | null = null;

// Required, not imported: on Android Expo Go merely importing it throws.
function sdk() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-notifications') as typeof import('expo-notifications');
}

export async function getPushPermission(): Promise<PermissionStatus | 'unavailable'> {
  if (!native) return 'unavailable';
  return (await sdk().getPermissionsAsync()).status;
}

export async function registerForPush(userId: string): Promise<boolean> {
  if (!native) return false;
  const Notifications = sdk();
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Pidro',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return false;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await pushApi.register({
      token,
      platform: Platform.OS as 'ios' | 'android',
      install_id: await getInstallId(),
      app_version: APP_CONFIG.version,
    });
    registered = { token, userId };
    return true;
  } catch (error) {
    console.warn('[Push] Could not register', error);
    return false;
  }
}

/** At start: only an install that already allows notifications, and never a prompt. */
export async function registerPushIfGranted(userId: string): Promise<void> {
  if (registered?.userId === userId || (await getPushPermission()) !== 'granted') return;
  await registerForPush(userId);
}

/** Called before the session is cleared; bounded, so signing out never waits long. */
export async function unregisterPush(): Promise<void> {
  const token = registered?.token;
  registered = null;
  if (!token) return;
  await Promise.race([
    pushApi
      .unregister(token)
      .catch((error: unknown) => console.warn('[Push] Could not unregister', error)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

/** Foreground banners without sound, and taps that open `data.url`. Returns the cleanup. */
export function listenForPush(): () => void {
  if (!native) return () => {};
  const Notifications = sdk();
  Notifications.setNotificationHandler({ handleNotification: async () => FOREGROUND_PRESENTATION });
  const open = { route: (path: string) => router.push(path as never), url: Linking.openURL };
  // Each tap is handled once, including the one that launched the app before this listener.
  const handle = (response: Parameters<typeof handlePushResponse>[0]) => {
    Notifications.clearLastNotificationResponse();
    handlePushResponse(response, open);
  };
  const launch = Notifications.getLastNotificationResponse();
  if (launch) handle(launch);
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
