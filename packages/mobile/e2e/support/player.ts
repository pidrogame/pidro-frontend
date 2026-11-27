import { randomBytes, randomUUID } from 'node:crypto';
import { CLASSIC_PASSWORD } from './classic-stand-in';

export const AGE_ANSWERED = JSON.stringify({
  state: { ageBand: '18_plus', termsVersion: '1' },
  version: 0,
});

/** One identity per test, so tests run in parallel and a rerun needs no reset. */
export function newPlayer() {
  const id = randomBytes(4).toString('hex');
  return {
    id,
    email: `e2e_${id}@example.com`,
    name: `Pid${id}`,
    password: 'hallohallo1',
    newPassword: 'hallohallo2',
    installId: randomUUID(),
    classicLogin: `classic-${id}`,
    classicPassword: CLASSIC_PASSWORD,
  };
}

export type Player = ReturnType<typeof newPlayer>;
