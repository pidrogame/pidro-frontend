// Plain calls to the backend, for setup and for asking the server afterwards.
import { randomUUID } from 'node:crypto';
import type { Player } from './player';

export const API = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';

export async function api(
  path: string,
  { method = 'GET', body, token }: { method?: string; body?: object; token?: string } = {}
) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: '*/*',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload: any = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, payload };
}

async function expectStatus(result: Awaited<ReturnType<typeof api>>, status: number, what: string) {
  if (result.status !== status)
    throw new Error(`${what}: ${result.status} ${JSON.stringify(result.payload)}`);
  return result.payload.data;
}

export async function register(player: Player) {
  const result = await api('/api/v1/auth/register', {
    method: 'POST',
    body: {
      user: { username: player.name, email: player.email, password: player.password },
      age_band: '18_plus',
      terms_version: '1',
    },
  });
  return expectStatus(result, 201, 'register') as Promise<{ token: string; user: { id: string } }>;
}

/** An account from before the age gate: no age answer on the server. */
export async function registerWithoutAge(player: Player) {
  const result = await api('/api/v1/auth/register', {
    method: 'POST',
    body: { user: { username: player.name, email: player.email, password: player.password } },
  });
  return expectStatus(result, 201, 'register') as Promise<{ token: string; user: { id: string } }>;
}

export async function guest(player: Player) {
  const result = await api('/api/v1/auth/guest', {
    method: 'POST',
    body: {
      platform: 'web',
      creation_token: randomUUID(),
      install_id: player.installId,
      age_band: '18_plus',
      terms_version: '1',
    },
  });
  return expectStatus(result, 201, 'guest') as Promise<{ token: string; user: { id: string } }>;
}

export async function login(
  player: Pick<Player, 'password'>,
  identifier: string,
  password = player.password
) {
  return api('/api/v1/auth/login', { method: 'POST', body: { username: identifier, password } });
}

/** Who the server says this token is. */
export async function whoAmI(token: string) {
  const result = await api('/api/v1/auth/me', { token });
  return (await expectStatus(result, 200, 'me')).user as {
    id: string;
    guest: boolean;
    email: string | null;
  };
}

/** The player's own profile, including its Classic section. */
export async function profile(token: string) {
  return expectStatus(await api('/api/v1/profile', { token }), 200, 'profile');
}

export async function deleteAccount(token: string) {
  await api('/api/v1/auth/me', { method: 'DELETE', token });
}

/** Claims a Classic account as a brand-new player, the way a first-launch claim does. */
export async function claimClassic(player: Player, login = player.classicLogin) {
  const verified = await expectStatus(
    await api('/api/v1/classic/verify', {
      method: 'POST',
      body: {
        method: 'password',
        login,
        password: player.classicPassword,
        install_id: player.installId,
      },
    }),
    200,
    'classic verify'
  );
  return (await expectStatus(
    await api('/api/v1/classic/claim', {
      method: 'POST',
      body: {
        ticket: verified.ticket,
        install_id: player.installId,
        age_band: '18_plus',
        terms_version: '1',
        account: { username: player.name, email: player.email, password: player.password },
      },
    }),
    200,
    'classic claim'
  )) as { token: string; user: { id: string; email: string } };
}

/** A host with a table open for one more player, and the invite to it. */
export async function inviteToTable(host: Player) {
  const { token } = await register(host);
  const room = await expectStatus(
    await api('/api/v1/rooms', { method: 'POST', token, body: { name: `${host.name} table` } }),
    201,
    'create room'
  );
  const created = await api(`/api/v1/rooms/${room.code}/invites`, {
    method: 'POST',
    token,
    body: { platform: 'web' },
  });
  const { code } = (await expectStatus(created, 201, 'create invite')).invite as { code: string };
  return { code, room: room.code as string, token };
}

export async function revokeInvite(token: string, code: string) {
  await expectStatus(
    await api(`/api/v1/invites/${code}`, { method: 'DELETE', token }),
    204,
    'revoke'
  );
}
