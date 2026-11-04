import { getLocale, t, type LeagueId, type LeagueState } from '@pidro/shared';

/** Display order only; promotion and demotion counts always come from the server. */
export const LEAGUES = [
  { id: 'deuce', rank: '2', suit: '♣', red: false, labelKey: 'league.name.deuce' },
  { id: 'ten', rank: '10', suit: '♦', red: true, labelKey: 'league.name.ten' },
  { id: 'jack', rank: 'J', suit: '♥', red: true, labelKey: 'league.name.jack' },
  { id: 'ace', rank: 'A', suit: '♠', red: false, labelKey: 'league.name.ace' },
  { id: 'pidro', rank: '', suit: '♠', red: false, labelKey: 'league.name.pidro' },
] as const;

export function leagueName(id: LeagueId): string {
  return t(LEAGUES.find((league) => league.id === id)!.labelKey);
}

/** Short name for ribbons, e.g. "Jack", not "Jack league". */
export function leagueMarkName(id: LeagueId): string {
  return t(`league.mark.${id}`);
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
      league: leagueName(data.league),
    });
  }
  if (data.status === 'not_placed') {
    return t('league.line.not_placed', { league: leagueName(data.league) });
  }
  return null;
}

/** Local calendar day and clock; duration is elapsed time, including across DST. */
export function closeTimeText(
  closesAt: string,
  now: Date = new Date(),
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): string {
  const close = new Date(closesAt);
  if (!Number.isFinite(close.getTime()) || !Number.isFinite(now.getTime())) return '';
  const locale = getLocale();
  const calendarDate = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  const day =
    calendarDate(close) === calendarDate(now)
      ? t('league.close.today')
      : new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long' }).format(close);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(close);
  const minutes = Math.max(0, Math.ceil((close.getTime() - now.getTime()) / 60_000));
  const duration =
    minutes === 0
      ? t('league.close.closed')
      : minutes >= 1440
        ? t('league.close.days', { count: Math.floor(minutes / 1440) })
        : minutes >= 60
          ? t('league.close.hours', { count: Math.floor(minutes / 60) })
          : t('league.close.minutes', { count: minutes });
  return t('league.close.line', { day, time, duration });
}
