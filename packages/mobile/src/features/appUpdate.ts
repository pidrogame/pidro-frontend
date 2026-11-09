import { formatDate, t } from '@pidro/shared';

export const STARTUP_UPDATE_LIMIT_MS = 5000;

/** Once startup lets the player in, a late download must wait for the next launch. */
export function startupUpdateDecision({
  enabled,
  inGame,
  finished,
  pending,
  elapsedMs,
}: {
  enabled: boolean;
  inGame: boolean;
  finished: boolean;
  pending: boolean;
  elapsedMs: number;
}) {
  if (!enabled || inGame || finished || elapsedMs >= STARTUP_UPDATE_LIMIT_MS) return 'continue';
  return pending ? 'reload' : 'wait';
}

type PerPlatform = Partial<Record<'android' | 'ios', string>>;

/**
 * Below the minimum version, or on it and below the minimum build, gets the nudge. The
 * beta keeps its version and counts builds; without a build minimum only the version counts.
 */
export function nativeStoreUpdate(
  platform: string,
  installed: { version: string | null; build: string | null },
  minimums: { versions: PerPlatform; builds?: PerPlatform },
  storeUrls: PerPlatform
) {
  if (platform !== 'android' && platform !== 'ios') return null;
  const minimum = minimums.versions[platform];
  const url = storeUrls[platform];
  if (!url) return null;
  const version = (value: string | null | undefined) =>
    value && /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
  const build = (value: string | null | undefined) =>
    value && /^\d+$/.test(value) ? Number(value) : null;
  const current = version(installed.version);
  const required = version(minimum);
  if (!current || !required) return null;
  const nudge = { id: `${platform}:${minimum}:${url}`, url };
  const difference = current.findIndex((part, index) => part !== required[index]);
  if (difference >= 0) return current[difference]! < required[difference]! ? nudge : null;
  const [have, need] = [build(installed.build), build(minimums.builds?.[platform])];
  return have !== null && need !== null && have < need ? nudge : null;
}

/** Beta testers update an iPhone in TestFlight; nowhere to update has no label. */
export function updateStoreLabel(platform: string, variant: string | undefined) {
  if (platform === 'android') return t('news.updateAndroid');
  if (platform !== 'ios') return null;
  return t(variant === 'beta' ? 'news.updateTestFlight' : 'news.updateIos');
}

/** "You have build 14 · this is build 19", only when both are known and installed is below. */
export function updateBuildLine(
  installed: string | null | undefined,
  minimum: string | null | undefined
) {
  if (!installed || !minimum || !/^\d+$/.test(installed) || !/^\d+$/.test(minimum)) return null;
  if (Number(installed) >= Number(minimum)) return null;
  return t('news.updateBuilds', { installed, minimum });
}

export interface RunningUpdateInput {
  /** OTA updates work in this build: a release build, not web or dev. */
  enabled: boolean;
  isEmbeddedLaunch: boolean;
  updateId: string | null | undefined;
  /** Inlined by scripts/publish-beta.mjs; an update published before PID-265 has none. */
  name?: string;
  sha?: string;
  /** The publish day, YYYY-MM-DD. */
  date?: string;
}

/**
 * What Settings says is running: "Vaasa-Boudreaux · Oct 20", and under it the
 * short sha and the update id for support.
 */
export function runningUpdate({
  enabled,
  isEmbeddedLaunch,
  updateId,
  name,
  sha,
  date,
}: RunningUpdateInput): { label: string; detail: string | null } {
  if (!enabled) return { label: t('update.development'), detail: null };
  if (isEmbeddedLaunch) return { label: t('update.embedded'), detail: null };
  if (!updateId) return { label: t('update.unavailable'), detail: null };
  if (!name) return { label: updateId.slice(0, 8), detail: updateId };
  const [year, month, day] = (date?.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? []).slice(1).map(Number);
  // The publish day as a calendar date, so no time zone moves it.
  const published = year
    ? formatDate(new Date(year, month - 1, day), { day: 'numeric', month: 'short' })
    : null;
  return {
    label: published ? `${name} · ${published}` : name,
    detail: sha ? `${sha}\n${updateId}` : updateId,
  };
}

export function channelLabel(channel: string | null | undefined) {
  if (channel === 'beta') return t('update.channelBeta');
  if (channel === 'production') return t('update.channelProduction');
  return channel || t('update.unavailable');
}

/** Dev fixtures for Settings → About the app: `?fixture=update-named|update-embedded|update-fallback`. */
export function appUpdateFixture(value?: string) {
  if (!__DEV__ || !value?.startsWith('update-')) return undefined;
  const release = { version: '3.0.0', build: '57', channel: 'beta', enabled: true };
  const updateId = '0199f3a2-7c41-7d2e-9b8a-5e6f1c2d3a4b';
  if (value === 'update-named')
    return {
      ...release,
      isEmbeddedLaunch: false,
      updateId,
      name: 'Vaasa-Boudreaux',
      sha: '5cca7d0',
      date: '2026-10-20',
    };
  if (value === 'update-embedded') return { ...release, isEmbeddedLaunch: true, updateId };
  if (value === 'update-fallback') return { ...release, isEmbeddedLaunch: false, updateId };
  return undefined;
}
