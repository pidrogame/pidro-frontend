import { describe, expect, it } from 'bun:test';
import { AxiosError } from 'axios';
import { createApiClient } from '@pidro/shared';
import { runGuestSave } from '../../src/features/auth/saveGuest';

const guest = {
  id: 'player-1',
  username: 'guest_12345678',
  display_name: 'Amber Fox',
  email: null,
  guest: true,
};
const saved = { ...guest, username: 'amber_fox', email: 'amber@example.com', guest: false };

function setup() {
  let session = { accessToken: 'guest-token', user: guest };
  let preservesSession = false;
  const installed = [];
  return {
    original: session,
    getSession: () => session,
    changeSession: (next) => {
      session = next;
    },
    install: (response) => installed.push(response),
    setSessionPreservation: (preserve) => {
      preservesSession = preserve;
    },
    preservesSession: () => preservesSession,
    installed,
  };
}

const args = { displayName: 'Amber Fox', email: 'amber@example.com', password: 'password123' };

describe('guest account saving', () => {
  it('installs the rotated token only for the same player', async () => {
    const state = setup();
    const result = await runGuestSave({
      ...args,
      ...state,
      upgrade: async () => ({ token: 'saved-token', user: saved }),
      login: async () => {
        throw new Error('not called');
      },
    });
    expect(result).toEqual({ ok: true });
    expect(state.installed).toEqual([{ token: 'saved-token', user: saved }]);
  });

  it('recovers a committed upgrade whose response was lost', async () => {
    const state = setup();
    const result = await runGuestSave({
      ...args,
      ...state,
      upgrade: async () => {
        throw new AxiosError('timeout', 'ECONNABORTED');
      },
      login: async (identifier, password) => {
        expect([identifier, password]).toEqual(['amber@example.com', 'password123']);
        return { token: 'recovered-token', user: saved };
      },
    });
    expect(result).toEqual({ ok: true });
    expect(state.installed).toEqual([{ token: 'recovered-token', user: saved }]);
  });

  it('preserves the original guest when another protected request gets 401 during recovery', async () => {
    const state = setup();
    let cleared = 0;
    const api = createApiClient({
      config: {
        baseURL: 'https://example.test',
        wsURL: 'wss://example.test',
        timeout: 1000,
      },
      getToken: () => 'guest-token',
      clearSession: () => cleared++,
      shouldPreserveSessionOnUnauthorized: state.preservesSession,
    });
    api.defaults.adapter = async (config) => {
      throw new AxiosError('unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config,
        data: {},
      });
    };

    const result = await runGuestSave({
      ...args,
      ...state,
      upgrade: async () => {
        throw new AxiosError('timeout', 'ECONNABORTED');
      },
      login: async () => {
        await expect(api.get('/me')).rejects.toBeInstanceOf(AxiosError);
        return { token: 'recovered-token', user: saved };
      },
    });

    expect(cleared).toBe(0);
    expect(result).toEqual({ ok: true });
    expect(state.installed).toEqual([{ token: 'recovered-token', user: saved }]);
    expect(state.preservesSession()).toBe(false);
  });

  it('recovers when a repeated save finds the guest token already rotated', async () => {
    const state = setup();
    const response = {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config: {},
      data: { errors: [{ code: 'UNAUTHORIZED', detail: 'Invalid token' }] },
    };
    const result = await runGuestSave({
      ...args,
      ...state,
      upgrade: async () => {
        throw new AxiosError('unauthorized', 'ERR_BAD_REQUEST', undefined, undefined, response);
      },
      login: async () => ({ token: 'recovered-token', user: saved }),
    });
    expect(result).toEqual({ ok: true });
    expect(state.installed).toEqual([{ token: 'recovered-token', user: saved }]);
  });

  it('never installs a different player during recovery', async () => {
    const state = setup();
    const result = await runGuestSave({
      ...args,
      ...state,
      upgrade: async () => {
        throw new AxiosError('network');
      },
      login: async () => ({ token: 'other-token', user: { ...saved, id: 'player-2' } }),
    });
    expect(result.ok).toBe(false);
    expect(state.installed).toEqual([]);
    expect(state.preservesSession()).toBe(true);
  });

  it('does not recover or replace the guest after a definitive field error', async () => {
    const state = setup();
    let loginCalled = false;
    const response = {
      status: 422,
      statusText: 'Unprocessable Entity',
      headers: {},
      config: {},
      data: {
        errors: [{ code: 'classic_name_reserved', title: 'Display name', detail: 'Reserved' }],
      },
    };
    const result = await runGuestSave({
      ...args,
      ...state,
      upgrade: async () => {
        throw new AxiosError('validation', 'ERR_BAD_REQUEST', undefined, undefined, response);
      },
      login: async () => {
        loginCalled = true;
        return { token: 'nope', user: saved };
      },
    });
    expect(loginCalled).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: {
        message: 'This name belongs to a player in the old Pidro app. Sign in as that player to use it.',
        fields: { displayName: 'That name is taken.' },
        classicNameReserved: true,
      },
    });
    expect(state.installed).toEqual([]);
  });
});
