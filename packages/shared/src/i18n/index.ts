import { I18n } from 'i18n-js';
import { useSyncExternalStore } from 'react';
import { catalogs, type TranslationKey } from './catalogs';

export * from './catalogs';
export * from './errors';
export type Locale = 'en' | 'sv';
export type LanguagePreference = Locale;
export type TranslationValues = Record<string, string | number>;

/** The device's language: the first English or Swedish in its order, else English. */
export function resolveLocale(deviceLanguageTags: readonly string[] = []): Locale {
  for (const tag of deviceLanguageTags) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    if (language === 'en' || language === 'sv') return language;
  }
  return 'en';
}

const i18n = new I18n(catalogs);
i18n.defaultLocale = 'en';
i18n.enableFallback = true;
i18n.defaultSeparator = '::';
i18n.locale = 'en';
const listeners = new Set<() => void>();

export const getLocale = (): Locale => i18n.locale as Locale;

/** Sets the resolved runtime locale, not the persisted language preference. */
export function setLocale(locale: Locale): void {
  if (locale === getLocale()) return;
  i18n.locale = locale;
  listeners.forEach((listener) => listener());
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, () => 'en');
}

export function t(key: TranslationKey, values: TranslationValues = {}): string {
  return i18n.t(key, values);
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

export function formatDate(
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(getLocale(), options).format(value);
}
