import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '@/stores/settings';

/** Feedback is optional polish, never part of whether an action succeeds. */
export function runHaptic(effect: () => Promise<void>) {
  if (Platform.OS === 'web' || !useSettingsStore.getState().hapticEnabled) return;
  void effect().catch(() => {});
}

/** The lightest selection tick, shared by menu controls and game choices. */
export function playSelectionHaptic() {
  runHaptic(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick)
      : Haptics.selectionAsync()
  );
}

/** Something the player sent arrived. */
export function playSuccessHaptic() {
  runHaptic(() =>
    Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)
      : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  );
}
