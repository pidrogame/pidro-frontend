import { expect } from '@playwright/test';
import { api } from './api';

type Mail = { to: unknown; reply_to?: unknown; subject?: string; text_body: string };

/** The latest email that matches, polled for a few seconds: a mail may land after the answer. */
async function latest(matches: (mail: Mail) => boolean, missing: string) {
  let mail: Mail | undefined;
  await expect
    .poll(
      async () => {
        const { payload } = await api('/dev/mailbox/json');
        return (mail = (payload.data as Mail[]).findLast(matches));
      },
      { message: missing, timeout: 5_000 }
    )
    .toBeDefined();
  return mail as Mail;
}

/** The dev backend keeps every email it sends; this finds the latest one for an address. */
export function mailTo(email: string) {
  return latest(
    (item) => String(item.to).includes(email),
    `no email for ${email} in the dev mailbox`
  );
}

export async function classicCodeFor(email: string) {
  const mail = await latest(
    (item) => String(item.to).includes(email) && item.subject === 'Your Pidro sign-in code',
    `no Classic sign-in code for ${email} in the dev mailbox`
  );
  const code = /^([0-9]{6})\r?$/m.exec(mail.text_body)?.[1];
  if (!code) throw new Error('No six-digit code in the Classic sign-in email');
  return code;
}

/**
 * The app's reset screen with the token of the link the reset email carries. On a phone the
 * link itself opens that screen (app/+native-intent.tsx); in dev it names another host and has
 * no `/app`, so this takes only the token.
 */
export async function resetScreenFor(email: string) {
  const mail = await mailTo(email);
  const token = /\/reset-password\?token=([^\s&]+)/.exec(mail.text_body)?.[1];
  if (!token) throw new Error(`no reset link in: ${mail.text_body}`);
  return `/reset-password?token=${token}`;
}
