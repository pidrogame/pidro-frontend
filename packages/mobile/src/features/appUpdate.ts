import { formatDate, t } from '@pidro/shared';

/**
 * When the "new version is ready" notice shows, and when coming back to the
 * app is worth a quiet update check. Expo downloads updates in the background;
 * these decide only what the player sees and how often we ask.
 */

/** Coming back to the app checks at most this often. */
export const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

export function nativeStoreUpdate(
  platform: string,
  installed: string | null,
  minimums: Partial<Record<'android' | 'ios', string>>,
  storeUrls: Partial<Record<'android' | 'ios', string>>
) {
  if (platform !== 'android' && platform !== 'ios') return null;
  const minimum = minimums[platform];
  const url = storeUrls[platform];
  if (!url) return null;
  const version = (value: string | null | undefined) =>
    value && /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
  const current = version(installed);
  const required = version(minimum);
  if (!current || !required) return null;
  const difference = current.findIndex((part, index) => part !== required[index]);
  if (difference < 0 || current[difference]! > required[difference]!) return null;
  return {
    id: `${platform}:${minimum}:${url}`,
    url,
  };
}

export interface UpdateNoticeInput {
  /** OTA updates work in this build: a release build, not web or dev. */
  enabled: boolean;
  isUpdatePending: boolean;
  downloadedUpdateId: string | null | undefined;
  /** The update the player dismissed this session, if any. */
  dismissedUpdateId: string | null;
  /** Seated at a table. A restart there would cost a hand. */
  inGame: boolean;
}

/** The update the notice is about, or null when there is nothing to offer. */
export function pendingUpdateId({
  enabled,
  isUpdatePending,
  downloadedUpdateId,
}: Pick<UpdateNoticeInput, 'enabled' | 'isUpdatePending' | 'downloadedUpdateId'>) {
  if (!enabled || !isUpdatePending) return null;
  return downloadedUpdateId ?? 'pending';
}

export function shouldShowUpdateNotice(input: UpdateNoticeInput) {
  const id = pendingUpdateId(input);
  return id !== null && id !== input.dismissedUpdateId && !input.inGame;
}

export function shouldCheckOnForeground({
  enabled,
  busy,
  now,
  lastCheckedAt,
}: {
  enabled: boolean;
  /** A check or download is already running. */
  busy: boolean;
  now: number;
  lastCheckedAt: number | null | undefined;
}) {
  if (!enabled || busy) return false;
  return lastCheckedAt == null || now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
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
