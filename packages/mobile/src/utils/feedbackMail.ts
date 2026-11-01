import { Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Updates from 'expo-updates';
import { publicPlayerName } from '@pidro/shared';
import { feedbackMailto, type FeedbackDetails } from '@/features/feedback';
import { useAuthStore } from '@/stores/auth';

/** The build, the phone and the player, for a posted note and a mail alike. */
export function feedbackDetails(): FeedbackDetails {
  const user = useAuthStore.getState().user;
  return {
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
  };
}

/** Opens a new mail to Marcel. False when no mail app took it, so the caller shows the address. */
export async function openFeedbackMail(body?: string): Promise<boolean> {
  try {
    await Linking.openURL(feedbackMailto(feedbackDetails(), body));
    return true;
  } catch {
    return false;
  }
}
