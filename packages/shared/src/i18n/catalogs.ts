import * as core from './sections/core';
import * as auth from './sections/auth';
import * as social from './sections/social';
import * as game from './sections/game';
import * as shell from './sections/shell';
import * as errors from './sections/errors';
import * as bots from './sections/bots';
import * as league from './sections/league';

// One composition for every platform. Section owners add keys in their module.
export const catalogs = {
  en: { ...core.en, ...auth.en, ...social.en, ...game.en, ...shell.en, ...errors.en, ...bots.en, ...league.en },
  sv: { ...core.sv, ...auth.sv, ...social.sv, ...game.sv, ...shell.sv, ...errors.sv, ...bots.sv, ...league.sv },
};
export type TranslationKey = keyof typeof catalogs.en;

export type TranslationEntry =
  string | { one: string; other: string; zero?: string };

/** Also validates plural branches, so new sections cannot silently drift. */
export function validateCatalogs(
  en: Record<string, TranslationEntry>,
  sv: Record<string, TranslationEntry>,
): string[] {
  const errors: string[] = [];
  const placeholders = (text: string) =>
    [...text.matchAll(/%\{([^}]+)\}/g)]
      .map((match) => match[1])
      .sort()
      .join(',');
  for (const key of new Set([...Object.keys(en), ...Object.keys(sv)])) {
    const a = en[key];
    const b = sv[key];
    if (a === undefined || b === undefined) {
      errors.push(`${key}: missing translation`);
      continue;
    }
    if (typeof a !== typeof b) {
      errors.push(`${key}: plural shape differs`);
      continue;
    }
    const left = typeof a === 'string' ? { text: a } : a;
    const right = typeof b === 'string' ? { text: b } : b;
    if (
      Object.keys(left).sort().join(',') !== Object.keys(right).sort().join(',')
    ) {
      errors.push(`${key}: plural branches differ`);
    }
    for (const branch of Object.keys(left)) {
      const x = (left as Record<string, string>)[branch];
      const y = (right as Record<string, string>)[branch];
      if (!x || !y || placeholders(x) !== placeholders(y)) {
        errors.push(`${key}.${branch}: empty text or placeholders differ`);
      }
    }
  }
  return errors;
}
