import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

/** OTA updates run only in installed release builds, not Expo Go or web previews. */
export const updatesEnabled = Platform.OS !== 'web' && !__DEV__ && Updates.isEnabled;
