import type { ApiClient } from './client';

/** What comes along with a note, so the team can find the build and the phone. */
export interface FeedbackNoteDetails {
  app_version?: string;
  app_build?: string;
  native_build?: string;
  update_id?: string;
  channel?: string;
  platform: string;
  os_version?: string;
  device_model?: string;
}

export type FeedbackAskKind = 'pace' | 'old_pidro';
export type PaceAnswer = 'too_slow' | 'right' | 'too_fast';
export type OldPidroAnswer = 'worse' | 'same' | 'better';
export type FeedbackAnswer = PaceAnswer | OldPidroAnswer;

export type FeedbackRequest =
  | {
      kind: 'note';
      body: string;
      reply_email?: string;
      details: FeedbackNoteDetails;
      /** A Write back answers this news post. */
      news_post_id?: number;
    }
  | { kind: 'pace'; answer: PaceAnswer | 'skipped'; game_id: string }
  | { kind: 'old_pidro'; answer: OldPidroAnswer | 'skipped'; game_id: string };

/** The server decides whether to ask about a game; `ask` is null when it does not. */
export interface FeedbackAsk {
  ask: FeedbackAskKind | null;
  game_id: string | null;
}

export function createFeedbackApi(api: ApiClient) {
  return {
    send: async (request: FeedbackRequest): Promise<{ id: number }> => {
      const response = await api.post<{ data: { id: number } }>('/api/v1/feedback', request);
      return response.data.data;
    },

    ask: async (): Promise<FeedbackAsk> => {
      const response = await api.get<{ data?: Partial<FeedbackAsk> }>('/api/v1/feedback/ask');
      const data = response.data?.data;
      return { ask: data?.ask ?? null, game_id: data?.game_id ?? null };
    },
  };
}

export type FeedbackApi = ReturnType<typeof createFeedbackApi>;
