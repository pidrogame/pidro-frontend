import { describe, expect, it } from 'bun:test';
import type { ApiClient } from '../src/api/client';
import { createFeedbackApi } from '../src/api/feedback';

function recordingApi(responses: unknown[]) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  let index = 0;
  const reply = () => Promise.resolve({ data: responses[index++] });
  const api = {
    get: (path: string) => {
      calls.push({ method: 'get', path });
      return reply();
    },
    post: (path: string, body?: unknown) => {
      calls.push({ method: 'post', path, body });
      return reply();
    },
  } as unknown as ApiClient;
  return { api, calls };
}

describe('feedback API', () => {
  it('posts a note or an answer as is and returns its id', async () => {
    const { api, calls } = recordingApi([{ data: { id: 42 } }]);
    const answer = { kind: 'pace', answer: 'too_slow', game_id: 'g-1' } as const;
    expect(await createFeedbackApi(api).send(answer)).toEqual({ id: 42 });
    expect(calls).toEqual([{ method: 'post', path: '/api/v1/feedback', body: answer }]);
  });

  it('reads the question to ask, and none when the server sends none', async () => {
    const { api, calls } = recordingApi([
      { data: { ask: 'old_pidro', game_id: 'g-2' } },
      { data: { ask: null } },
    ]);
    const feedback = createFeedbackApi(api);
    expect(await feedback.ask()).toEqual({ ask: 'old_pidro', game_id: 'g-2' });
    expect(await feedback.ask()).toEqual({ ask: null, game_id: null });
    expect(calls.map((call) => call.path)).toEqual(['/api/v1/feedback/ask', '/api/v1/feedback/ask']);
  });
});
