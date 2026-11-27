// What a journey needs from the identity stand-in: a token for an identity, and the answer the
// client takes in place of the native sheet. Three shapes of sign-in: Apple's identity token,
// Facebook's Limited Login token (bound to a nonce) and a classic Facebook access token.
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { IDENTITY_STAND_IN } from './identity-stand-in';

/** What the client's seam (e2eProviders.ts) hands back instead of the native sheet. */
type Answer =
  | { status: 'success'; provider: 'apple'; token: string }
  | {
      status: 'success';
      provider: 'facebook';
      credential:
        | { type: 'authentication_token'; token: string; nonce: string }
        | { type: 'access_token'; token: string };
    };

export type Who = { id: string; email: string };

/**
 * An identity by name. The name says what Classic knows about it (classic-stand-in.ts): `classic-…`
 * is a Classic player's email and Facebook id alike.
 */
export const identity = (name: string): Who => ({ id: name, email: `${name}@example.com` });

async function sign(provider: 'apple' | 'facebook', claims: object) {
  const response = await fetch(`${IDENTITY_STAND_IN}/sign`, {
    method: 'POST',
    body: JSON.stringify({ provider, claims }),
  });
  return ((await response.json()) as { token: string }).token;
}

/** `answer` is what the provider gives for this identity. */
export type Shape = {
  name: string;
  button: string;
  provider: 'apple' | 'facebook';
  answer: (who: Who) => Promise<Answer>;
};

const appleAnswer = async (who: Who): Promise<Answer> => ({
  status: 'success',
  provider: 'apple',
  token: await sign('apple', { sub: who.id, email: who.email, email_verified: true }),
});

export const apple: Shape = {
  name: 'Apple',
  button: 'Continue with Apple',
  provider: 'apple',
  answer: (who) => appleAnswer(who),
};

const limitedAnswer = async (who: Who): Promise<Answer> => {
  const nonce = randomUUID().replaceAll('-', '');
  const token = await sign('facebook', { sub: who.id, email: who.email, nonce });
  return {
    status: 'success',
    provider: 'facebook',
    credential: { type: 'authentication_token', token, nonce },
  };
};

export const facebookLimited: Shape = {
  name: 'Facebook Limited Login',
  button: 'Continue with Facebook',
  provider: 'facebook',
  answer: (who) => limitedAnswer(who),
};

const accessTokenAnswer = async (who: Who): Promise<Answer> => ({
  status: 'success',
  provider: 'facebook',
  credential: {
    type: 'access_token',
    token: `fb.${Buffer.from(JSON.stringify(who)).toString('base64url')}`,
  },
});

export const facebookAccessToken: Shape = {
  name: 'Facebook access token',
  button: 'Continue with Facebook',
  provider: 'facebook',
  answer: (who) => accessTokenAnswer(who),
};

export const shapes = [apple, facebookLimited, facebookAccessToken];

/** The next tap on Apple or Facebook gets this answer. */
export function answerNextTap(page: Page, answer: Answer) {
  return page.evaluate((next) => {
    (globalThis as { __pidroE2E?: unknown }).__pidroE2E = next;
  }, answer);
}
