import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { nunitoFamily, NUNITO_STATIC } from '../src/features/nunito.ts';

test('on Android each weight the roles use is its own static family', () => {
  expect(nunitoFamily('android', '500')).toBe('Nunito-Medium');
  expect(nunitoFamily('android', '600')).toBe('Nunito-SemiBold');
  expect(nunitoFamily('android', '700')).toBe('Nunito-Bold');
  expect(nunitoFamily('android', '800')).toBe('Nunito-ExtraBold');
  expect(nunitoFamily('android', '900')).toBe('Nunito-Black');
  expect(nunitoFamily('android', 900)).toBe('Nunito-Black');
  expect(nunitoFamily('android', 'bold')).toBe('Nunito-Bold');
});

test('on Android a weight the app does not ship gets the nearest one, never the light default', () => {
  expect(nunitoFamily('android', undefined)).toBe('Nunito-Medium');
  expect(nunitoFamily('android', 'normal')).toBe('Nunito-Medium');
  expect(nunitoFamily('android', '200')).toBe('Nunito-Medium');
  expect(nunitoFamily('android', '1000')).toBe('Nunito-Black');
});

test('iPhone and web keep the one variable family for every weight', () => {
  for (const platform of ['ios', 'web']) {
    expect(nunitoFamily(platform, '900')).toBe('Nunito');
    expect(nunitoFamily(platform, '500')).toBe('Nunito');
  }
});

test('every static family has its file and the root layout loads it under its name', () => {
  const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  for (const family of Object.values(NUNITO_STATIC)) {
    expect(existsSync(new URL(`../assets/fonts/${family}.ttf`, import.meta.url))).toBe(true);
    expect(layout).toContain(`'${family}': require('../assets/fonts/${family}.ttf')`);
  }
});
