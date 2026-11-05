import {
  getLocale,
  t,
  type LeagueId,
  type LeagueResult,
  type LeagueState,
  type LeagueRibbon,
} from '@pidro/shared';

/** Display order only; promotion and demotion counts always come from the server. */
export const LEAGUES = [
  { id: 'deuce', rank: '2', suit: '♥', red: true, labelKey: 'league.name.deuce' },
  { id: 'ten', rank: '10', suit: '♥', red: true, labelKey: 'league.name.ten' },
  { id: 'jack', rank: 'J', suit: '♥', red: true, labelKey: 'league.name.jack' },
  { id: 'ace', rank: 'A', suit: '♥', red: true, labelKey: 'league.name.ace' },
  { id: 'pidro', rank: '5', suit: '♥', red: true, labelKey: 'league.name.pidro' },
] as const;

export function leagueName(id: LeagueId): string {
  return t(LEAGUES.find((league) => league.id === id)!.labelKey);
}

export function nextLeague(id: LeagueId): LeagueId | null {
  return LEAGUES[LEAGUES.findIndex((league) => league.id === id) + 1]?.id ?? null;
}

export function previousLeague(id: LeagueId): LeagueId | null {
  return LEAGUES[LEAGUES.findIndex((league) => league.id === id) - 1]?.id ?? null;
}

export function ordinal(place: number): string {
  const lastTwo = place % 100;
  const last = place % 10;
  if (getLocale() === 'sv') {
    return `${place}:${(last === 1 || last === 2) && lastTwo !== 11 && lastTwo !== 12 ? 'a' : 'e'}`;
  }
  const suffix =
    lastTwo >= 11 && lastTwo <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[last] ?? 'th');
  return `${place}${suffix}`;
}

export function leagueBands(
  _league: LeagueId,
  room: { size: number; promote: number; demote: number }
): { promoteAfter: number | null; demoteFrom: number | null } {
  return {
    promoteAfter: room.promote > 0 ? room.promote : null,
    demoteFrom: room.demote > 0 ? room.size - room.demote + 1 : null,
  };
}

export function leagueLine(data: LeagueState): string | null {
  if (!data.league) return null;
  if (data.status === 'placed' && data.me) {
    return t('league.line.placed', {
      place: ordinal(data.me.place),
    });
  }
  if (data.status === 'not_placed') {
    return t('league.not_placed');
  }
  return null;
}

export function shouldShowLeagueResult(result: LeagueResult | null): boolean {
  return result?.move === 'up' || result?.move === 'down';
}

export function placeArrow(before: number | null, after: number): string {
  return before == null || before === after ? '' : after < before ? ' ↑' : ' ↓';
}

export function leagueGameLine(
  before: LeagueState | null,
  after: LeagueState,
  points: number
): string | null {
  if (
    after.status !== 'placed' ||
    !after.me ||
    !after.league ||
    (before && !['placed', 'not_placed'].includes(before.status))
  )
    return null;
  const place = ordinal(after.me.place);
  if (before?.status === 'not_placed') return t('league.game.joined', { place });
  const comparable =
    before?.league === after.league && before?.week?.starts_at === after.week?.starts_at;
  return `${t('league.game.points', { points, place })}${placeArrow(comparable ? (before?.me?.place ?? null) : null, after.me.place)}`;
}

export function shouldPinLeagueRow(
  row: { y: number; height: number },
  offset: number,
  viewport: number,
  footerHeight: number,
  pinned = false
): boolean {
  return (
    row.height > 0 &&
    viewport > footerHeight &&
    (row.y < offset || row.y + row.height > offset + viewport - (pinned ? footerHeight : 0))
  );
}

export function ribbonMonth(month: string, short = false): string {
  return new Intl.DateTimeFormat(getLocale(), {
    month: short ? 'short' : 'long',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T12:00:00Z`));
}

export function ribbonHistory(ribbons: LeagueState['ribbons']): LeagueRibbon[] {
  return [...ribbons.past, ...(ribbons.current ? [ribbons.current] : [])]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);
}

/** Elapsed whole minutes, independent of local calendars and DST. */
export function closeTimeText(closesAt: string, now: Date = new Date()): string {
  const close = new Date(closesAt);
  if (!Number.isFinite(close.getTime()) || !Number.isFinite(now.getTime())) return '';
  const minutes = Math.max(0, Math.floor((close.getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return minutes >= 1440
    ? t('league.close.days', { days: Math.floor(hours / 24), hours: hours % 24 })
    : t('league.close.hours', { hours, minutes: minutes % 60 });
}
