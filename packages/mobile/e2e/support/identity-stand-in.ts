// Stands in for Apple's key server and for Facebook on 127.0.0.1:4002. The backend is started with
// APPLE_JWKS_URL, FACEBOOK_JWKS_URL, FACEBOOK_GRAPH_URL, APPLE_AUDIENCE and FACEBOOK_APP_ID pointing
// here and checks every token exactly as in production; only the key server and the Graph host differ.
// The key is made at startup and signs the tokens a journey asks for (POST /sign). A classic Facebook
// access token carries its own identity: `fb.` and the base64url of {id, email?}.
import { createSign, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';

export const IDENTITY_STAND_IN = 'http://127.0.0.1:4002';
// The same values the CI backend is started with (ci.sh).
export const APPLE_AUDIENCE = 'com.pidro.e2e';
export const FACEBOOK_APP_ID = '1234567890';

const KID = 'e2e-key';
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256' }] };

const ISSUERS = {
  apple: { iss: 'https://appleid.apple.com', aud: APPLE_AUDIENCE },
  facebook: { iss: 'https://www.facebook.com', aud: FACEBOOK_APP_ID },
};

function sign(provider: keyof typeof ISSUERS, claims: object) {
  const signed = `${encode({ alg: 'RS256', kid: KID })}.${encode({
    ...ISSUERS[provider],
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  })}`;
  const signature = createSign('RSA-SHA256').update(signed).sign(privateKey).toString('base64url');
  return `${signed}.${signature}`;
}

type GraphWho = { id: string; email?: string };

function graph(path: string, query: URLSearchParams): [number, object] {
  const token = query.get('input_token') ?? query.get('access_token') ?? '';
  let who: GraphWho | null = null;
  try {
    who = JSON.parse(Buffer.from(token.replace(/^fb\./, ''), 'base64url').toString());
  } catch {
    // not one of ours
  }
  if (path === '/graph/debug_token') {
    return [
      200,
      {
        data: who
          ? { is_valid: true, app_id: FACEBOOK_APP_ID, user_id: who.id }
          : { is_valid: false },
      },
    ];
  }
  if (!who) return [400, { error: { message: 'Invalid OAuth access token' } }];
  if (path === '/graph/me')
    return [200, { id: who.id, ...(who.email ? { email: who.email } : {}) }];
  if (path === '/graph/me/ids_for_business') return [200, { data: [{ id: who.id }] }];
  return [404, { error: 'not found' }];
}

function answer(method: string, url: URL, body: string): [number, object] {
  if (method === 'GET' && url.pathname === '/apple/auth/keys') return [200, jwks];
  if (method === 'GET' && url.pathname === '/facebook/jwks') return [200, jwks];
  if (method === 'GET' && url.pathname.startsWith('/graph/'))
    return graph(url.pathname, url.searchParams);
  if (method === 'POST' && url.pathname === '/sign') {
    try {
      const { provider, claims } = JSON.parse(body || '{}');
      if (provider in ISSUERS) return [200, { token: sign(provider, claims) }];
    } catch {
      // answered below
    }
    return [400, {}];
  }
  return [404, { error: 'not found' }];
}

export default async function startIdentityStandIn() {
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
  await new Promise<void>((done) => server.listen(4002, '127.0.0.1', done));
  return () => new Promise<void>((done) => server.close(() => done()));
}
