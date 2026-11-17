import { expect, test } from 'bun:test';
import { createSettingsStore } from '@pidro/shared';
import { countHelpOn } from '../src/features/countHelp.ts';

const guest = { id: 'g-1', username: 'guest_1', guest: true };
const newcomer = { id: 'u-new', username: 'Nora' };
const oldPidro = { id: 'u-old', username: 'Bengt64', classic: true };

test('never chosen, Counting follows the account', () => {
  expect(countHelpOn(null, null)).toBe(true);
  expect(countHelpOn(null, guest)).toBe(true);
  expect(countHelpOn(null, newcomer)).toBe(true);
  expect(countHelpOn(null, oldPidro)).toBe(false);
});

test('a stored choice wins either way', () => {
  for (const user of [null, guest, newcomer, oldPidro]) {
    expect(countHelpOn(true, user)).toBe(true);
    expect(countHelpOn(false, user)).toBe(false);
  }
});

test('two accounts on one phone, and a guest who signs in as an old-Pidro account', () => {
  const storage = memory();
  const store = createSettingsStore({ storage });
  const choice = () => store.getState().countHelp;
  expect(choice()).toBeNull();
  // The same untouched phone answers per account, as each signs in.
  expect(countHelpOn(choice(), guest)).toBe(true);
  expect(countHelpOn(choice(), oldPidro)).toBe(false);
  expect(countHelpOn(choice(), newcomer)).toBe(true);
  // A choice made on the phone is kept and survives a restart.
  store.getState().setCountHelp(true);
  const restored = createSettingsStore({ storage });
  expect(restored.getState().countHelp).toBe(true);
  expect(countHelpOn(restored.getState().countHelp, oldPidro)).toBe(true);
});

test('a stored value from an older build stays a choice', () => {
  for (const saved of [true, false]) {
    const store = createSettingsStore({
      storage: memory(JSON.stringify({ version: 0, state: { countHelp: saved, showBid: false } })),
    });
    expect(store.getState().countHelp).toBe(saved);
    expect(countHelpOn(store.getState().countHelp, guest)).toBe(saved);
    expect(countHelpOn(store.getState().countHelp, oldPidro)).toBe(saved);
  }
});

function memory(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
}
