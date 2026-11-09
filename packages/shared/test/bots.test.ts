import { afterEach, expect, test } from 'bun:test';
import { botPlay, botPortrait, normalizeBotProfiles, resolveBotProfile } from '../src/utils/bots';
import { catalogs } from '../src/i18n/catalogs';
import { seatPlayerName } from '../src/utils/playerName';
import { normalizeRoom } from '../src/utils/rooms';
import { useBotCatalogueStore } from '../src/stores/bots';
import { useGameStore, roomWithReadiness } from '../src/stores/game';
import type { BotProfile, ReadinessSnapshot } from '../src/types/lobby';

const saga: BotProfile = {
  id: '1c477a6a-fb56-4b4f-a6b5-3b1390c60102',
  name: 'Saga',
  description: '',
  avatar_url: 'https://backend.example/images/bots/antti.svg',
};
afterEach(() => {
  useBotCatalogueStore.getState().setProfiles([]);
  useGameStore.getState().reset();
});

test('opaque new identity can use any tracked native-safe drawing', () => {
  for (const persona of ['marcel', 'antti', 'jocke']) {
    expect(
      botPortrait(saga.id, {
        ...saga,
        avatar_url: `https://backend.example/images/bots/${persona}.svg`,
      }),
    ).toEqual({ kind: 'builtin', persona });
    expect(botPortrait(persona)).toEqual({ kind: 'builtin', persona });
  }
  expect(botPortrait('unrecognized')).toEqual({ kind: 'neutral' });
  expect(
    botPortrait(saga.id, { ...saga, avatar_url: 'https://backend.example/images/bots/new.svg' }),
  ).toEqual({ kind: 'neutral' });
});

test('JPEG failure becomes neutral, and a changed upload URL can load again', () => {
  const upload = {
    ...saga,
    avatar_url: `https://backend.example/api/v1/bots/${saga.id}/avatar/hash`,
  };
  expect(botPortrait(saga.id, upload)).toEqual({ kind: 'remote', uri: upload.avatar_url });
  expect(botPortrait(saga.id, upload, upload.avatar_url)).toEqual({ kind: 'neutral' });
  expect(
    botPortrait(saga.id, { ...upload, avatar_url: `${upload.avatar_url}2` }, upload.avatar_url)
      .kind,
  ).toBe('remote');
  expect(botPortrait('marcel', upload, upload.avatar_url)).toEqual({ kind: 'neutral' });
});

test('snapshot metadata wins over catalogue, then legacy and neutral fallbacks', () => {
  useBotCatalogueStore.getState().setProfiles([saga]);
  const renamed = { ...saga, name: 'Renamed' };
  expect(resolveBotProfile(saga.id, renamed, [saga])).toBe(renamed);
  expect(resolveBotProfile(saga.id, null, [saga])).toBe(saga);
  expect(resolveBotProfile(null, saga, [saga])).toBeNull();
  expect(seatPlayerName({ bot_persona: saga.id, bot_profile: renamed })).toBe('Renamed');
  expect(seatPlayerName({ bot_persona: saga.id })).toBe('Saga');
  expect(seatPlayerName({ bot_persona: 'marcel' }, 'Bot')).toBe('Marcel');
  expect(seatPlayerName({ bot_persona: 'unknown', username: 'bot_internal' }, 'Bot')).toBe('Bot');
  expect(seatPlayerName({ bot_persona: null, bot_profile: saga, username: 'Ritva' })).toBe('Ritva');
  expect(normalizeBotProfiles([saga, { id: 42 }, null])).toEqual([saga]);
});

test('the catalogue keeps how a character plays, sounds and thinks, and drops junk', () => {
  const lines = ['Nå…', 'Hmm…', 'Jaha…', 'Tja…', 'Well…', 'Ok…', 'Joo…', 'Aha…', 'Ninth…'];
  const [full, junk, old] = normalizeBotProfiles([
    { ...saga, strategy: 'search', tempo: 'slow', home: 'finland', lines, enabled: false, extra: 'kept out' },
    { ...saga, strategy: 7, tempo: null, home: 'sweden', lines: [' ', 3, 'Nå…', null], enabled: 'no' },
    saga,
  ]);
  expect(full).toStrictEqual({
    ...saga,
    strategy: 'search',
    tempo: 'slow',
    home: 'finland',
    lines: lines.slice(0, 8),
    enabled: false,
  });
  expect(junk).toStrictEqual({ ...saga, lines: ['Nå…'] });
  expect(old).toStrictEqual(saga);
  for (const bad of ['Nå…', [], [' ', ''], { 0: 'Nå…' }]) {
    expect(normalizeBotProfiles([{ ...saga, lines: bad }])[0].lines).toBeUndefined();
  }
});

test('the sheet says a search character plays the odds, anything else the honest game', () => {
  expect(botPlay('search')).toBe('bots.play_search');
  for (const strategy of ['rulebook', 'random', 'Search', undefined, null, 3]) {
    expect(botPlay(strategy)).toBe('bots.play_rulebook');
  }
  for (const locale of ['en', 'sv'] as const) {
    expect(catalogs[locale]['bots.play_search']).not.toBe(catalogs[locale]['bots.play_rulebook']);
    expect(catalogs[locale]['bots.play_rulebook']).not.toMatch(/three|tre/);
  }
});

test('room hydration preserves profile; human replacement clears it', () => {
  const room = normalizeRoom({
    code: 'CREW',
    status: 'waiting',
    positions: { north: 'bot_north' },
    seats: {
      north: {
        user_id: 'bot_north',
        occupant_type: 'bot',
        bot_persona: saga.id,
        bot_profile: saga,
      },
    },
  });
  expect(room.seats?.[0].player?.bot_profile).toEqual(saga);
  useGameStore.getState().initFromRoom({ room, youPlayerId: 'viewer' });
  expect(useGameStore.getState().playerMeta.north.bot_profile).toEqual(saga);
  const vacant = { occupant_type: 'vacant', status: 'vacant', user_id: null } as const;
  const snapshot: ReadinessSnapshot = {
    room_id: 'room',
    ready_epoch: 1,
    snapshot_revision: 1,
    status: 'waiting',
    positions: { north: 'human', south: null, east: null, west: null },
    ready_players: [],
    seats: {
      north: {
        occupant_type: 'bot',
        status: 'bot_substitute',
        user_id: 'human',
        username: 'Ritva',
        bot_persona: null,
        bot_profile: null,
      },
      south: vacant,
      east: vacant,
      west: vacant,
    },
  };
  const replacement = roomWithReadiness(room, snapshot);
  expect(
    replacement.seats?.find((seat) => seat.position === 'north')?.player?.bot_profile,
  ).toBeNull();
  useGameStore.getState().setReadiness(snapshot);
  expect(useGameStore.getState().playerMeta.north.bot_profile).toBeNull();
  expect(useGameStore.getState().playerMeta.north.bot_persona).toBeNull();
  expect(useGameStore.getState().playerMeta.north.username).toBe('Ritva');
});
