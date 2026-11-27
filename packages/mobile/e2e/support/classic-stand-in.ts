// Stands in for Classic on 127.0.0.1:4001, where the dev backend already looks
// for it (empty secret). Stateless: the login says what Classic would answer.
//   classic-…  an account with a short password; reusable-… has an eight-character password
//   other      unknown
// A lookup by email or by Facebook id names the same account: `classic-1f@x.example` and the id
// `classic-1f` are one player.
// The Classic id is a hash of the login, so parallel tests share nothing.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

export const CLASSIC_PASSWORD = 'oldpass';
export const REUSABLE_CLASSIC_PASSWORD = 'oldpass8';

const classicId = (login: string) => createHash('sha1').update(login).digest().readUIntBE(0, 5);

const KNOWN = /^(classic|reusable)-/;

// Mirrors the production payload pinned in the backend's classic_client_test.exs.
function profile(login: string) {
  return {
    id: classicId(login),
    username: login,
    has_username: true,
    first_name: null,
    email: `${login}@classic.example`,
    fbid: null,
    member_since: '2012-04-03T10:00:00',
    avatar: { picture_index: 0, url: null },
    xp: 48_200,
    level: 42,
    games: {
      // The old total, and the counter kept since December 2016.
      legacy_played_games: 300,
      legacy_victories: 160,
      legacy_losses: 140,
      total_game: 1284,
      win_game: 700,
      lost_game: 584,
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
    const known = KNOWN.test(name);
    const expected = name.startsWith('reusable-') ? REUSABLE_CLASSIC_PASSWORD : CLASSIC_PASSWORD;
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
