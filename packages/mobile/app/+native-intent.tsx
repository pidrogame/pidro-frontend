import { parseFriendLink, parseInviteLink } from '@pidro/shared';

const APP_SCHEMES = new Set(['pidro-mobile:', 'pidro-mobile-dev:', 'pidro-mobile-beta:']);

/**
 * Dev harness routes opened straight from a simulator (`just table-sim`,
 * `xcrun simctl openurl … exp://host/--/table-dev?phase=bidding`). Without this
 * allowlist the catch-all below swallows them into +not-found, which silently
 * costs the whole fixture loop. Release builds never reach it — the routes
 * themselves are `__DEV__`-guarded too.
 */
const DEV_FIXTURE_ROUTES = new Set([
  'table-dev',
  'ui-dev',
  'auth-flow-dev',
  // Account screens with `?fixture=` states (docs/FIXTURE-ROUTES.md).
  'login',
  'register',
  'forgot-password',
  'claim-classic',
  'classic-forgot',
  'classic-help',
]);

function devFixturePath(path: string): string | null {
  if (!__DEV__) return null;

  let route: string;
  try {
    const url = new URL(path);
    // Only our own schemes and Expo's dev schemes may open a harness route.
    if (!APP_SCHEMES.has(url.protocol) && !url.protocol.startsWith('exp')) return null;
    // Expo Go and the dev client carry the in-app route after `/--/`.
    const marker = path.indexOf('/--/');
    route = marker >= 0 ? path.slice(marker + 4) : `${url.hostname}${url.pathname}${url.search}`;
  } catch {
    if (!path.startsWith('/')) return null;
    route = path;
  }

  route = route.replace(/^\/+/, '');
  const name = route.split(/[?#]/)[0].replace(/\/+$/, '');
  return DEV_FIXTURE_ROUTES.has(name) ? `/${route}` : null;
}

const SITE_HOSTS = new Set(['pidro.online', 'www.pidro.online']);

/** A reset email's `https://pidro.online/app/reset-password?token=…` opens the reset screen. */
function resetPasswordPath(path: string): string | null {
  try {
    const url = new URL(path);
    if (url.protocol !== 'https:' || !SITE_HOSTS.has(url.hostname)) return null;
    if (url.pathname.replace(/\/+$/, '') !== '/app/reset-password') return null;
    // No token still opens the screen: it says the link is broken and offers a new one.
    const token = url.searchParams.get('token');
    return token ? `/reset-password?token=${encodeURIComponent(token)}` : '/reset-password';
  } catch {
    return null;
  }
}

function isAppStartupPath(path: string): boolean {
  if (path === '' || path === '/') return true;

  try {
    const url = new URL(path);
    if (
      APP_SCHEMES.has(url.protocol) &&
      !url.hostname &&
      (url.pathname === '' || url.pathname === '/')
    ) {
      return true;
    }
    return url.protocol === 'exp+pidro-mobile:' && url.hostname === 'expo-development-client';
  } catch {
    return false;
  }
}

export function redirectSystemPath({ path }: { path: string; initial?: boolean }): string {
  const fixture = devFixturePath(path);
  if (fixture) return fixture;

  const reset = resetPasswordPath(path);
  if (reset) return reset;

  const friend = parseFriendLink(path);
  if (friend) return `/play/${friend}`;

  const invite = parseInviteLink(path);
  if (!invite) return isAppStartupPath(path) ? '/' : '/+not-found';

  const source = invite.source ? `?source=${invite.source}` : '';
  return `/join/${invite.code}${source}`;
}
