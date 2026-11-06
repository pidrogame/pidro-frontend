import { expect, test } from 'bun:test';
import { extractGamePresentation, extractGameState } from '../src/channels/gamePayloads';

const publicRob = {
  dealer: 'south',
  automatic: true,
  started_at_ms: 10,
  ends_at_ms: 20,
};

test('keeps the completed snapshot and its transition delay together, including zero', () => {
  const state = {
    phase: 'playing',
    current_player: 'east',
    current_trick: [],
    tricks: [],
  };
  for (const delay of [0, 80, 1500, 3000]) {
    for (const envelope of [{ state }, { game_state: state }, { data: { state } }]) {
      expect(extractGameState({ ...envelope, transition_delay_ms: delay })).toEqual({
        ...state,
        transition_delay_ms: delay,
      });
    }
  }
  expect(state).not.toHaveProperty('transition_delay_ms');
  expect(extractGameState({ state })).toEqual(state);
});

test('keeps the envelope cursor with its state without requiring it from old servers', () => {
  const state = { phase: 'playing', current_player: 'east' };
  const cursor = { game_instance_id: 'opaque-nonUUID_instance', state_revision: 0, turn_event_seq: 9 };
  for (const envelope of [{ state, ...cursor }, { data: { state, ...cursor } }])
    expect(extractGameState(envelope)).toEqual({ ...state, ...cursor });
  expect(extractGameState({ state })).toEqual(state);
  expect(extractGameState({ state, ...cursor, state_revision: -1 })).toEqual(state);
  expect(state).not.toHaveProperty('game_instance_id');
});

test('accepts public and private dealer rob presentations', () => {
  expect(extractGamePresentation({ presentation: { dealer_rob: publicRob } })).toEqual({
    dealer_rob: publicRob,
  });

  const privateRob = {
    ...publicRob,
    pool: [{ rank: 14, suit: 'diamonds' }],
    kept: [{ rank: 14, suit: 'diamonds' }],
    discarded: [],
  };
  expect(extractGamePresentation({ presentation: { dealer_rob: privateRob } })).toEqual({
    dealer_rob: privateRob,
  });
});

test('rejects malformed dealer rob card arrays and metadata', () => {
  expect(
    extractGamePresentation({
      presentation: { dealer_rob: { ...publicRob, pool: {} } },
    }),
  ).toBeNull();
  expect(
    extractGamePresentation({
      presentation: {
        dealer_rob: { ...publicRob, pool: [{ rank: 15, suit: 'diamonds' }] },
      },
    }),
  ).toBeNull();
  expect(
    extractGamePresentation({
      presentation: { dealer_rob: { ...publicRob, automatic: 'yes' } },
    }),
  ).toBeNull();
});
