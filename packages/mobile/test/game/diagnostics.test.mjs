import { describe, expect, it } from 'bun:test';
import { DiagnosticBuffer } from '../../src/diagnostics/buffer.ts';
describe('private game diagnostics', () => {
  it('copies allowed fields only, never raw errors, cards, coordinates or credentials', () => {
    const buffer = new DiagnosticBuffer();
    buffer.identify('owner', 'ABCD');
    buffer.observe({ game_instance_id: 'instance', state_revision: 8 });
    const contaminated = {
      type: 'push',
      code: 'failed',
      action: 'play_card',
      action_id: 'attempt-1',
      state_revision: 12,
      password: 'secret',
      jwt: 'secret',
      email: 'private@example.com',
      card: { rank: 14, suit: 'spades' },
      x: 33,
      state: { hand: ['secret'] },
    };
    buffer.record(contaminated);
    contaminated.state_revision = 200;
    expect(buffer.snapshot().events.at(-1)).toEqual({
      type: 'push',
      code: 'failed',
      action: 'play_card',
      action_id: 'attempt-1',
      state_revision: 12,
      offset_ms: expect.any(Number),
    });
    buffer.record(
      JSON.parse(
        '{"type":"push","code":"secret error","action":"secret","action_id":"bad token","state_revision":-1}'
      )
    );
    expect(buffer.snapshot().events.at(-1)).toEqual({
      type: 'push',
      code: 'failed',
      action: 'none',
      offset_ms: expect.any(Number),
    });
    expect(JSON.stringify(buffer.snapshot())).not.toContain('secret');
    expect(JSON.stringify(buffer.snapshot()).length).toBeLessThan(32768);
  });
  it.each([false, true])(
    'keeps a 429 cooldown with its reporter (delayed response: %s)',
    (delayed) => {
      // Isolate the native/session boundary mocks from the other app tests. Keep the
      // real API client: token interception, serialization and error handling all run.
      const result = Bun.spawnSync(
        [
          process.execPath,
          '-e',
          `
        import { mock } from 'bun:test';
        import assert from 'node:assert/strict';
        import { AxiosError } from 'axios';
        import { createApiClient } from '@pidro/shared';
        let owner = 'account-A';
        const api = createApiClient({
          config: { baseURL: 'https://example.test', timeout: 1000 },
          getToken: () => owner + '-token', clearSession: () => {},
        });
        mock.module('./src/api/client.ts', () => ({ api }));
        mock.module('./src/stores/auth.ts', () => ({ authStore: { getState: () => ({ user: { id: owner } }) } }));
        mock.module('./src/diagnostics/metadata.ts', () => ({ diagnosticMetadata: { app_version: '1.0', build: '1', platform: 'web' } }));
        const { gameDiagnostics } = await import('./src/diagnostics/buffer.ts');
        const { captureGameReport, sendGameReport } = await import('./src/diagnostics/report.ts');
        const capture = () => {
          gameDiagnostics.identify(owner, 'TEST');
          gameDiagnostics.observe({ game_instance_id: 'instance', state_revision: 1 });
          return captureGameReport();
        };
        let release, dispatched;
        const gate = new Promise(resolve => { release = resolve; });
        const started = new Promise(resolve => { dispatched = resolve; });
        api.defaults.adapter = async config => {
          assert.equal(config.headers.Authorization, 'Bearer account-A-token');
          dispatched();
          await gate;
          throw new AxiosError('rate limited', 'ERR_BAD_REQUEST', config, undefined, {
            status: 429, headers: { 'retry-after': '3600' }, config, data: {},
          });
        };
        const first = sendGameReport(capture());
        const rejected = assert.rejects(first, { kind: 'rate_limited' });
        await started;
        if (${delayed}) owner = 'account-B';
        release();
        await rejected;
        if (!${delayed}) {
          await assert.rejects(sendGameReport(capture()), { kind: 'rate_limited' });
          owner = 'account-B';
        }
        api.defaults.adapter = async config => {
          assert.equal(config.headers.Authorization, 'Bearer account-B-token');
          const body = JSON.parse(config.data);
          assert.equal(body.room_code, 'TEST');
          assert.equal('owner' in body, false);
          return { status: 201, headers: {}, config, data: { data: { id: 'f25f99d8-69cc-4cb9-9a6f-3829ba91488f' } } };
        };
        assert.equal(await sendGameReport(capture()), 'f25f99d8-69cc-4cb9-9a6f-3829ba91488f');
      `,
        ],
        { cwd: new URL('../..', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe' }
      );
      expect(result.stderr.toString()).toBe('');
      expect(result.exitCode).toBe(0);
    }
  );
});
