/**
 * Beta feedback goes straight to Marcel. The mail opens with room to write at
 * the top and, under it, what he needs to find the build and the player. The
 * details stay in English: they are read by the team, not the player.
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

export function feedbackMailto(details: FeedbackDetails): string {
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
  const body = ['', '', ...lines].join('\r\n');
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Pidro beta feedback')}&body=${encodeURIComponent(body)}`;
}
