import { expect, test } from 'bun:test';
import { catalogs, createSettingsStore, normalizeRoom } from '@pidro/shared';
import {
  filterLobby,
  filterRuleSet,
  lobbyHasBothRuleSets,
  lobbyRuleSetFilter,
  quickGameRequest,
  ruleSets,
  shouldExplainLouisiana,
} from '../src/features/rules/ruleSets.ts';

test('rules have a short and a long name in both languages, without changing the server values', () => {
  expect(Object.keys(ruleSets)).toEqual(['finnish', 'louisiana']);
  for (const [locale, short, long] of [
    ['en', ['Finnish', 'Louisiana'], ['Finnish rules', 'Louisiana rules']],
    ['sv', ['Finländska', 'Louisiana'], ['Finländska regler', 'Louisiana-regler']],
  ]) {
    const names = Object.values(ruleSets);
    expect(names.map(({ labelKey }) => catalogs[locale][labelKey])).toEqual(short);
    expect(names.map(({ longKey }) => catalogs[locale][longKey])).toEqual(long);
    expect(catalogs[locale]['social.finnish']).toBe(short[0]);
  }
});

test('the Tables filter hides the other rule set but never your own table', () => {
  const table = (code, rule_set) => normalizeRoom({ code, config: rule_set && { rule_set } });
  const seated = { ...table('SEATED', 'louisiana'), player_ids: ['me'] };
  // An older payload with no config at all is a Finnish table.
  const legacy = { code: 'OLD', status: 'waiting' };
  const lobby = {
    my_rejoinable: [table('MINE', 'louisiana')],
    open_tables: [table('LA1', 'louisiana'), legacy, table('FI1', 'finnish'), seated],
    substitute_needed: [table('LA2', 'louisiana')],
    spectatable: [table('FI2', 'finnish')],
  };
  const codes = (categories) =>
    Object.fromEntries(
      Object.entries(categories).map(([key, rooms]) => [key, rooms.map((room) => room.code)])
    );
  // A waiting table you sit at is listed with the open tables, and stays.
  expect(codes(filterLobby(lobby, 'finnish', 'me'))).toEqual({
    my_rejoinable: ['MINE'],
    open_tables: ['OLD', 'FI1', 'SEATED'],
    substitute_needed: [],
    spectatable: ['FI2'],
  });
  expect(codes(filterLobby(lobby, 'finnish')).open_tables).toEqual(['OLD', 'FI1']);
  expect(codes(filterLobby(lobby, 'louisiana', 'me'))).toEqual({
    my_rejoinable: ['MINE'],
    open_tables: ['LA1', 'SEATED'],
    substitute_needed: ['LA2'],
    spectatable: [],
  });
  expect(filterLobby(lobby, 'all')).toEqual(lobby);
});

test('the filter shows only when the tables it would filter hold both rule sets', () => {
  const table = (code, rule_set) => normalizeRoom({ code, config: rule_set && { rule_set } });
  const empty = { my_rejoinable: [], open_tables: [], substitute_needed: [], spectatable: [] };
  expect(lobbyHasBothRuleSets(empty)).toBe(false);
  // One of each, in different categories, is both kinds.
  expect(
    lobbyHasBothRuleSets({
      ...empty,
      substitute_needed: [table('LA', 'louisiana')],
      spectatable: [table('OLD')],
    })
  ).toBe(true);
  expect(
    lobbyHasBothRuleSets({
      ...empty,
      open_tables: [table('LA1', 'louisiana'), table('LA2', 'louisiana')],
    })
  ).toBe(false);
  // Your own tables are never filtered, so they do not make the list mixed.
  const yours = { ...table('SEATED', 'louisiana'), player_ids: ['me'] };
  const mine = {
    ...empty,
    my_rejoinable: [table('MINE', 'louisiana')],
    open_tables: [table('FI', 'finnish'), yours],
  };
  expect(lobbyHasBothRuleSets(mine, 'me')).toBe(false);
  expect(lobbyHasBothRuleSets(mine)).toBe(true);
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
  expect(store.getState().countHelp).toBeNull();
  store.getState().setCountHelp(false);
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
    countHelp: false,
  });
  expect(
    shouldExplainLouisiana('louisiana', restored.getState().hasSeenLouisianaRules, false)
  ).toBe(false);
});
