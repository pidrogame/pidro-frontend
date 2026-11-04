import {
  type ClassicProfile,
  type PinChoice,
  type ProfileIdentity,
  t,
  formatNumber,
  formatDate,
  getLocale,
  type TranslationKey,
} from '@pidro/shared';

// Stable server title vocabulary, not player-authored text. Unknown future titles
// retain their English presentation in EN, but cannot leak English into SV.
const TITLE_KEYS: Record<string, TranslationKey> = {
  Rookie: 'profile.rookie',
  Apprentice: 'profile.apprentice',
  Journeyman: 'profile.journeyman',
  Veteran: 'profile.veteran',
  Expert: 'profile.expert',
  Master: 'profile.master',
  Grandmaster: 'profile.grandmaster',
  Legend: 'profile.legend',
  Mainstay: 'profile.mainstay',
};

export function veteranTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const key = Object.prototype.hasOwnProperty.call(TITLE_KEYS, title)
    ? TITLE_KEYS[title]
    : undefined;
  return key ? t(key) : getLocale() === 'en' ? title : null;
}

/**
 * The numbers the profile shows, read from `GET /api/v1/profile`. The server
 * does the counting; these only decide how its answer reads.
 */

/** How far into the current level, 0 to 1, and the line beside the XP. */
export function levelProgress(veteran: ProfileIdentity['veteran']): {
  fraction: number;
  caption: string | null;
} {
  const progress = veteran?.progress;
  if (!veteran || progress == null) return { fraction: 0, caption: null };
  if (progress === 'max') return { fraction: 1, caption: t('social.top_level') };
  const [into, span] = progress;
  return {
    fraction: span > 0 ? Math.min(1, Math.max(0, into / span)) : 0,
    caption: t('social.xp_next', {
      xp: formatNumber(Math.max(0, span - into)),
      level: formatNumber(veteran.level + 1),
    }),
  };
}

export function winRate(rate: number): string {
  return formatNumber(rate, { style: 'percent', maximumFractionDigits: 0 });
}

/** The month the server's `this_month` counts, named in the player's language. */
export function monthName(now: Date = new Date()): string {
  return formatDate(now, { month: 'long', timeZone: 'UTC' });
}

/** The line under the Classic pin: "Level 61 in Classic · 1,862 games as Bengt64". */
export function classicPinLine(classic: ClassicProfile): string {
  const games =
    classic.games_played != null
      ? t('social.games', {
          count: classic.games_played,
          number: formatNumber(classic.games_played),
        })
      : null;
  const played = classic.name
    ? games
      ? t('social.classic_games_name', { games, name: classic.name })
      : t('social.played_as', { name: classic.name })
    : games;
  const parts = [
    classic.level != null
      ? t('social.classic_level', { level: formatNumber(classic.level) })
      : null,
    played,
  ];
  return parts.filter(Boolean).join(' · ') || t('social.classic_career');
}

/**
 * "Pidro player since 2011": the year of Classic's `member_since`, else the
 * account's. A Classic player without a date (Classic kept none before about
 * 2018) gets no year: their account's would say they started this year.
 */
export function sinceYear(
  identity: Pick<ProfileIdentity, 'classic' | 'first_seen_at'>
): number | null {
  const date = identity.classic ? identity.classic.member_since : identity.first_seen_at;
  const year = /^(\d{4})/.exec(date ?? '');
  return year ? Number(year[1]) : null;
}

/** The title line: "Legend ★4" in gold from level 100 up, otherwise the title as the server names it. */
export function titleLine(veteran: ProfileIdentity['veteran']): {
  text: string | null;
  legend: boolean;
} {
  const legend = (veteran?.level ?? 0) >= 100;
  const stars = veteran?.prestige ?? 0;
  if (legend && stars > 0)
    return { text: t('profile.legend_stars', { number: formatNumber(stars) }), legend };
  return { text: legend ? t('profile.legend') : veteranTitle(veteran?.title), legend };
}

/** From level 100 the card counts toward the next Legend star; null below it. */
export function legendProgress(veteran: ProfileIdentity['veteran']): {
  next: string;
  fraction: number;
  caption: string;
} | null {
  const progress = veteran?.prestige_progress;
  if (!progress) return null;
  const [into, step] = progress;
  return {
    next: t('profile.next_legend', { number: formatNumber((veteran?.prestige ?? 0) + 1) }),
    fraction: step > 0 ? Math.min(1, Math.max(0, into / step)) : 0,
    caption: t('profile.xp_to_go', { xp: formatNumber(Math.max(0, step - into)) }),
  };
}

export interface ShelfMedal {
  key: string;
  name: string;
  earned: boolean;
}

/**
 * The medals shelf: earned medals in the order earned, then locked ones from
 * the catalog to fill it. `total` is every medal there is, for "All N".
 */
export function medalShelf(
  earned: ProfileIdentity['achievements'] = [],
  catalog: ProfileIdentity['achievements_catalog'] = [],
  size = 5
): { medals: ShelfMedal[]; total: number } {
  const earnedKeys = new Set(earned.map((medal) => medal.key));
  const locked = catalog.filter((medal) => !medal.earned && !earnedKeys.has(medal.key));
  const all: ShelfMedal[] = [
    ...earned.map(({ key, name }) => ({ key, name, earned: true })),
    ...locked.map(({ key, name }) => ({ key, name, earned: false })),
  ];
  return { medals: all.slice(0, size), total: all.length };
}

/** "Bengt64 · level 61 there · 38,536 games, counted in your record above" */
export function classicRecordLine(classic: ClassicProfile): string {
  return [
    classic.name,
    classic.level != null
      ? t('profile.classic_there', { level: formatNumber(classic.level) })
      : null,
    classic.games_played != null
      ? t('profile.classic_counted', {
          games: t('social.games', {
            count: classic.games_played,
            number: formatNumber(classic.games_played),
          }),
        })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A Classic player wears the Classic pin until they choose No pin. */
export function wornPin(choice: PinChoice | undefined, classic: boolean): 'classic' | null {
  return classic && choice !== 'none' ? 'classic' : null;
}
