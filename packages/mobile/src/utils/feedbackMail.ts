import { Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Updates from 'expo-updates';
import { publicPlayerName } from '@pidro/shared';
import { feedbackMailto } from '@/features/feedback';
import { useAuthStore } from '@/stores/auth';

/** Opens a new mail to Marcel. False when no mail app took it, so the caller shows the address. */
export async function openFeedbackMail(): Promise<boolean> {
  const user = useAuthStore.getState().user;
  const url = feedbackMailto({
    appVersion: Application.nativeApplicationVersion,
    nativeBuild: Application.nativeBuildVersion,
    updateId: Updates.updateId,
    channel: Updates.channel,
    platform: Platform.OS,
    osVersion: Device.osVersion,
    deviceModel: Device.modelName,
    player: user
      ? { id: user.id, name: publicPlayerName(user.username, 'Player', user.display_name) }
      : null,
  });
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
