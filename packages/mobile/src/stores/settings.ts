import { getLocales } from 'expo-localization';
import { createSettingsStore } from '@pidro/shared';
import { secureStorage } from '@/utils/storage';

export const useSettingsStore = createSettingsStore({
  storage: secureStorage,
  detectLanguageTags: () => getLocales().map((locale) => locale.languageTag),
});
