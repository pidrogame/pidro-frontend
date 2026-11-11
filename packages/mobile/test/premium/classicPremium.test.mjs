import { afterEach, expect, test } from 'bun:test';
import { setLocale } from '@pidro/shared';
import { classicPremiumLine } from '../../src/features/premium/classicPremium.ts';

afterEach(() => setLocale('en'));

const ended = { state: 'ended', until: '2026-03-12T12:00:00Z' };

test('after a claim: carried and ended say one line, pending and absent say nothing', () => {
  expect(classicPremiumLine({ state: 'carried', until: '2027-03-12T12:00:00Z' })).toBe(
    'Your Pidro Premium came with you.'
  );
  expect(classicPremiumLine({ state: 'carried', until: null })).toBe(
    'Your Pidro Premium came with you.'
  );
  expect(classicPremiumLine(ended)).toBe(
    'Your Premium in the old Pidro app ended on 12 March 2026.'
  );
  expect(classicPremiumLine({ state: 'pending', until: null })).toBeNull();
  expect(classicPremiumLine({ state: 'pending', until: '2027-03-12T12:00:00Z' })).toBeNull();
  expect(classicPremiumLine(undefined)).toBeNull();
  expect(classicPremiumLine(null)).toBeNull();
  // Ended needs a date to say; an unknown state is a newer server's word.
  expect(classicPremiumLine({ state: 'ended', until: null })).toBeNull();
  expect(classicPremiumLine({ state: 'ended', until: 'soon' })).toBeNull();
  expect(classicPremiumLine({ state: 'granted', until: null })).toBeNull();
});

test('the same lines in Swedish', () => {
  setLocale('sv');
  expect(classicPremiumLine({ state: 'carried', until: null })).toBe(
    'Ditt Pidro Premium följde med dig.'
  );
  expect(classicPremiumLine(ended)).toBe('Ditt Premium i gamla Pidro tog slut den 12 mars 2026.');
  expect(classicPremiumLine({ state: 'pending', until: null })).toBeNull();
});
