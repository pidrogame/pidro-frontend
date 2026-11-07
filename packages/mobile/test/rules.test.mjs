import { expect, test } from 'bun:test';
import { catalogs, createSettingsStore, normalizeRoom } from '@pidro/shared';
import {
  filterRuleSet,
  lobbyRuleSetFilter,
  quickGameRequest,
  ruleSets,
  shouldExplainLouisiana,
} from '../src/features/rules/ruleSets.ts';

test('rules have one label each in both languages, without changing the server values', () => {
  expect(Object.keys(ruleSets)).toEqual(['finnish', 'louisiana']);
  for (const [locale, label] of [['en', 'Ostrobothnian'], ['sv', 'Österbottnisk']]) {
    expect(Object.values(ruleSets).map(({ labelKey }) => catalogs[locale][labelKey])).toEqual([
      label,
      'Louisiana',
    ]);
    expect(catalogs[locale]['social.finnish']).toBe(label);
  }
});

test('the lobby follows preference until a filter is saved, including All and legacy rooms', () => {
  const oldRoom = { code: 'OLD', status: 'waiting' };
  const finnish = normalizeRoom({ code: 'FI', config: { rule_set: 'finnish' } });
  const louisiana = normalizeRoom({ code: 'LA', config: { rule_set: 'louisiana' } });
  const rooms = [louisiana, oldRoom, finnish];
  expect(normalizeRoom(oldRoom).config?.rule_set).toBe('finnish');
  expect(filterRuleSet(rooms, lobbyRuleSetFilter('finnish', null))).toEqual([oldRoom, finnish]);
  expect(filterRuleSet(rooms, lobbyRuleSetFilter('louisiana', null))).toEqual([louisiana]);
  expect(filterRuleSet(rooms, lobbyRuleSetFilter('louisiana', 'all'))).toEqual(rooms);
  expect(lobbyRuleSetFilter('louisiana', 'finnish')).toBe('finnish');
});

// ads_aware: this build can show the ad the server may ask for (402 AD_REQUIRED, PID-120).
test('Quick game creates a solo table with exactly the preferred rules', () => {
  expect(quickGameRequest('finnish')).toEqual({
    rule_set: 'finnish',
    seats: { seat_2: 'ai', seat_3: 'ai', seat_4: 'ai' },
    ads_aware: true,
  });
  expect(quickGameRequest('louisiana')).toEqual({
    rule_set: 'louisiana',
    seats: { seat_2: 'ai', seat_3: 'ai', seat_4: 'ai' },
    ads_aware: true,
  });
});

test('device preferences and a dismissed Louisiana explanation survive rehydration', async () => {
  let value = null;
  const storage = {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
  };
  const store = createSettingsStore({ storage });
  expect(store.getState().preferredRuleSet).toBe('finnish');
  expect(store.getState().showBid).toBe(true);
  expect(store.getState().countHelp).toBe(false);
  store.getState().toggleShowBid();
  expect(shouldExplainLouisiana('finnish', false, false)).toBe(false);
  expect(shouldExplainLouisiana('louisiana', false, true)).toBe(false);
  expect(shouldExplainLouisiana('louisiana', false, false)).toBe(true);
  store.getState().setPreferredRuleSet('louisiana');
  store.getState().setLobbyRuleSetFilter('all');
  store.getState().markLouisianaRulesSeen();
  const restored = createSettingsStore({ storage });
  await restored.persist.rehydrate();
  expect(restored.getState()).toMatchObject({
    preferredRuleSet: 'louisiana',
    lobbyRuleSetFilter: 'all',
    hasSeenLouisianaRules: true,
    showBid: false,
    countHelp: false,
  });
  expect(
    shouldExplainLouisiana('louisiana', restored.getState().hasSeenLouisianaRules, false)
  ).toBe(false);
});
