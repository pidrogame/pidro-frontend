import { createContext, useContext, useEffect, useState } from 'react';
import { getLocale, setLocale, subscribeLocale, t, useLocale } from '@pidro/shared';
import { useSettingsStore } from '../stores/settings';
import type { LanguagePreference } from '@pidro/shared';

export const FixtureLanguageContext = createContext<{
  language: LanguagePreference;
  setLanguage: (language: LanguagePreference) => void;
} | null>(null);

export function useLanguagePreference() {
  const fixture = useContext(FixtureLanguageContext);
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  return fixture ?? { language, setLanguage };
}

let fixtureLocale: (() => void) | null = null;
const restoreLocale = () => {
  const { hydrated, language } = useSettingsStore.getState();
  if (hydrated) setLocale(language);
};

/** Only the guarded, focused fixture boundary installs this non-persisted override. */
export function installFixtureLocale(update: () => void) {
  if (!__DEV__) return () => {};
  fixtureLocale = update;
  update();
  return () => {
    if (fixtureLocale !== update) return;
    fixtureLocale = null;
    restoreLocale();
  };
}

export {
  t,
  useLocale,
  getLocale,
  setLocale,
  subscribeLocale,
  resolveLocale,
  formatNumber,
  formatDate,
} from '@pidro/shared';
export type { Locale, LanguagePreference, TranslationKey, TranslationValues } from '@pidro/shared';

export function useTranslation() {
  const locale = useLocale();
  return { t, locale };
}

/** Mount once in the root; no navigation or app-state reset on language changes. */
export function useLocaleBootstrap(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const updateDocument = () => {
      if (typeof document !== 'undefined') document.documentElement.lang = getLocale();
    };
    const unsubscribeDocument = subscribeLocale(updateDocument);
    updateDocument();
    const update = () => {
      const { hydrated, language } = useSettingsStore.getState();
      if (!hydrated) return;
      if (__DEV__ && fixtureLocale) fixtureLocale();
      else setLocale(language);
      setReady(true);
    };
    const unsubscribe = useSettingsStore.subscribe(update);
    update();
    return () => {
      unsubscribe();
      unsubscribeDocument();
    };
  }, []);
  return ready;
}
