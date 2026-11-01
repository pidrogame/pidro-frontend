import type { FeedbackAnswer, FeedbackAsk, FeedbackAskKind, FeedbackRequest } from '@pidro/shared';

/**
 * Beta feedback goes straight to Marcel: a note posted from the Tell us sheet,
 * or, when that fails, a mail. The details stay in English: they are read by
 * the team, not the player.
 */
export const FEEDBACK_EMAIL = 'marcel@pidro.online';

export interface FeedbackDetails {
  appVersion: string | null;
  nativeBuild: string | null;
  updateId: string | null;
  channel: string | null;
  platform: string;
  osVersion: string | null;
  deviceModel: string | null;
  player: { id: string; name: string } | null;
}

/** The words survive closing the sheet, until they are sent. */
export const draft = { body: '', email: '' };

/** The mail starts with the player's words, or room to write, then the details. */
export function feedbackMailto(details: FeedbackDetails, body = ''): string {
  const known = (value: string | null) => value || 'unknown';
  const lines = [
    `App version: ${known(details.appVersion)}`,
    `Native build: ${known(details.nativeBuild)}`,
    `Update: ${details.updateId || 'none'} (channel ${known(details.channel)})`,
    `Platform: ${details.platform} ${known(details.osVersion)}`,
    `Device: ${known(details.deviceModel)}`,
    `Player: ${details.player ? `${details.player.name} (${details.player.id})` : 'not signed in'}`,
  ];
  // RFC 6068: line breaks in a mailto body are CRLF.
  const mail = [...(body.trim() ? body.trim().split(/\r?\n/) : ['']), '', ...lines].join('\r\n');
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Pidro beta feedback')}&body=${encodeURIComponent(mail)}`;
}

/** The note as the server takes it; an empty reply address is left out, unknown details too. */
export function feedbackNote(
  body: string,
  replyEmail: string,
  details: FeedbackDetails
): FeedbackRequest {
  const value = (known: string | null) => known || undefined;
  return {
    kind: 'note',
    body: body.trim(),
    reply_email: replyEmail.trim() || undefined,
    details: {
      app_version: value(details.appVersion),
      native_build: value(details.nativeBuild),
      update_id: value(details.updateId),
      channel: value(details.channel),
      platform: details.platform,
      os_version: value(details.osVersion),
      device_model: value(details.deviceModel),
    },
  };
}

/** A note the server refused for today waits for tomorrow; anything else can be tried again. */
export function sendFailure(error: unknown): 'limit' | 'failed' {
  const response = (error as { response?: { status?: number; data?: { code?: string } } })
    ?.response;
  return response?.status === 429 || response?.data?.code === 'RATE_LIMITED' ? 'limit' : 'failed';
}

export const FEEDBACK_ANSWERS: Record<FeedbackAskKind, FeedbackAnswer[]> = {
  pace: ['too_slow', 'right', 'too_fast'],
  old_pidro: ['worse', 'same', 'better'],
};

/** The small card on Home: one question, the answer marked, then thanks. Null hides it. */
export interface AskCard {
  ask: FeedbackAskKind;
  gameId: string;
  picked: FeedbackAnswer | null;
  thanked: boolean;
}

export type AskEvent =
  | { type: 'asked'; answer: FeedbackAsk }
  | { type: 'picked'; answer: FeedbackAnswer }
  | { type: 'skipped' };

/**
 * The server says what to ask; the card only follows. A new question replaces
 * the row. No further question right after an answer is the thanks; anywhere
 * else it hides the card.
 */
export function nextAskCard(card: AskCard | null, event: AskEvent): AskCard | null {
  if (event.type === 'skipped') return null;
  if (event.type === 'picked')
    return card && !card.picked ? { ...card, picked: event.answer } : card;
  const { ask, game_id } = event.answer;
  if (ask && game_id) return { ask, gameId: game_id, picked: null, thanked: false };
  return card?.picked && !card.thanked ? { ...card, thanked: true } : null;
}

export type TellStage = 'write' | 'failed' | 'limit' | 'sent';

/** Dev fixtures `?fixture=tell-<state>` on Home and Settings: the sheet open in that state, or a question. */
export function tellFixture(fixture: string | undefined) {
  if (!fixture?.startsWith('tell-')) return null;
  const state = fixture.slice('tell-'.length);
  if (state === 'pace' || state === 'old')
    return {
      ask: { ask: state === 'old' ? 'old_pidro' : 'pace', game_id: 'fixture-game' } as FeedbackAsk,
    };
  const words =
    state === 'open' || state === 'chip'
      ? ''
      : 'The bid buttons are small on my phone. Otherwise lovely to have the game back.';
  return {
    sheet: {
      stage: (['failed', 'limit', 'sent'].includes(state) ? state : 'write') as TellStage,
      body: words,
      email: state === 'guest' ? 'bengt@example.com' : '',
      emailOpen: state === 'guest',
      chip: state === 'chip',
    },
  };
}
