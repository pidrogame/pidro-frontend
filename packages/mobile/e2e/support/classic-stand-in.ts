// Stands in for Classic on 127.0.0.1:4001, where the dev backend already looks
// for it (empty secret). Stateless: the login says what Classic would answer.
//   classic-…  an account with a short password; reusable-… has an eight-character password
//   unicode-…  four emoji: eight JS code units, but below the server's character minimum
//   off-…      one that is switched off
//   rude-…     a name that cannot be shown  other   unknown
//   nameless-… no username, only a first name (a pre-2017 account)
//   down-…     a lookup or password check that fails: Classic is unreachable
//   oldtotal-… / counter-… / lower-…  games: only the old total, a counter above it, one below it
// A lookup by email or by Facebook id names the same account: `classic-1f@x.example` and the id
// `classic-1f` are one player.
// The Classic id is a hash of the login, so parallel tests share nothing.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

export const CLASSIC_PASSWORD = 'oldpass';
export const REUSABLE_CLASSIC_PASSWORD = 'oldpass8';
export const UNICODE_CLASSIC_PASSWORD = '🐱🐶🐭🐹';

const classicId = (login: string) => createHash('sha1').update(login).digest().readUIntBE(0, 5);

const KNOWN = /^(classic|reusable|unicode|rude|nameless|oldtotal|counter|lower)-/;

// What a Classic player has played: the old total, and the counter kept since December 2016.
function games(login: string) {
  const base = {
    legacy_played_games: 300,
    legacy_victories: 160,
    legacy_losses: 140,
    total_game: 1284,
    win_game: 700,
    lost_game: 584,
  };
  if (login.startsWith('oldtotal-'))
    return { ...base, total_game: null, win_game: null, lost_game: null };
  if (login.startsWith('lower-')) return { ...base, total_game: 40, win_game: 20, lost_game: 20 };
  return base;
}

// Mirrors the production payload pinned in the backend's classic_client_test.exs.
function profile(login: string) {
  const nameless = login.startsWith('nameless-');
  return {
    id: classicId(login),
    username: login.startsWith('rude-') ? 'fuckface' : nameless ? null : login,
    has_username: !nameless,
    first_name: nameless ? 'Gertrude' : null,
    email: `${login}@classic.example`,
    fbid: null,
    member_since: '2012-04-03T10:00:00',
    avatar: { picture_index: 0, url: null },
    xp: 48_200,
    level: 42,
    games: {
      ...games(login),
      win_percent: 54,
      games_logged: 900,
      games_started: 950,
      games_ended: 930,
    },
    premium: { active: false, until: null, product: null },
    badges: [],
    account: { visible: true, deleted: false },
  };
}

function answer(method: string, url: URL, body: string): [number, object] {
  if (method === 'POST' && url.pathname === '/internal/claims/verify_password') {
    const { login = '', password } = JSON.parse(body || '{}');
    const name = String(login).toLowerCase();
    if (name.startsWith('down-')) return [503, { error: 'unavailable' }];
    if (name.startsWith('off-')) return [403, { error: 'inactive' }];
    const known = KNOWN.test(name);
    const expected = name.startsWith('reusable-')
      ? REUSABLE_CLASSIC_PASSWORD
      : name.startsWith('unicode-')
        ? UNICODE_CLASSIC_PASSWORD
        : CLASSIC_PASSWORD;
    if (!known || password !== expected) return [401, { error: 'invalid' }];
    return [200, { classic: profile(name) }];
  }
  if (method === 'GET' && url.pathname === '/internal/claims/lookup') {
    const key =
      url.searchParams.get('login') ??
      url.searchParams.get('email') ??
      url.searchParams.get('fbid') ??
      '';
    const name = key.split('@')[0].toLowerCase();
    if (name.startsWith('down-')) return [503, { error: 'unavailable' }];
    return KNOWN.test(name) ? [200, { classic: profile(name) }] : [404, { error: 'not found' }];
  }
  return [404, { error: 'not found' }];
}

export default async function startClassicStandIn() {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const [status, payload] = answer(
        request.method ?? 'GET',
        new URL(request.url ?? '/', 'http://x'),
        body
      );
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((done) => server.listen(4001, '127.0.0.1', done));
  return () => new Promise<void>((done) => server.close(() => done()));
}
