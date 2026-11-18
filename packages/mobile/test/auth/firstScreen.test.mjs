import { describe, expect, it } from 'bun:test';
import { firstScreen, keptPlayer } from '../../src/features/auth/firstScreen.ts';

const thor = {
  id: 'u1',
  email: 'thor@example.com',
  username: 'ThunderThor88',
  avatar_url: 'https://cdn.example/thor.jpg',
  avatar_face: 'b',
  guest: false,
};

describe('which first screen this phone shows (PID-456)', () => {
  it('a phone nobody signed in on shows the normal first screen', () => {
    expect(firstScreen(null)).toEqual({ kind: 'new' });
  });

  it('after a sign-in it greets that player, with the way they signed in', () => {
    for (const method of ['password', 'apple', 'facebook']) {
      expect(firstScreen(keptPlayer(thor, method))).toEqual({
        kind: 'known',
        player: { name: 'ThunderThor88', avatarUrl: thor.avatar_url, face: 'b', method },
      });
    }
  });

  it('keeps the name, the picture and the method, and nothing a sign-in needs', () => {
    const kept = JSON.parse(keptPlayer(thor, 'password'));
    expect(Object.keys(kept).sort()).toEqual(['avatarUrl', 'face', 'method', 'name']);
    expect(JSON.stringify(kept)).not.toContain('thor@example.com');
  });

  it('a player without a picture keeps no picture, and the screen falls back to a face', () => {
    const plain = { ...thor, avatar_url: null, avatar_face: undefined };
    expect(firstScreen(keptPlayer(plain, 'apple')).player).toEqual({
      name: 'ThunderThor88',
      avatarUrl: null,
      face: null,
      method: 'apple',
    });
  });

  it('a guest has no way back in, so the phone keeps no guest', () => {
    expect(keptPlayer({ ...thor, guest: true }, 'password')).toBeNull();
  });

  it('a record it cannot read shows the normal first screen, never a broken greeting', () => {
    for (const stored of [
      '',
      'not json',
      'null',
      '"ThunderThor88"',
      '{}',
      JSON.stringify({ name: '   ', method: 'password' }),
      JSON.stringify({ name: 'ThunderThor88' }),
      JSON.stringify({ name: 'ThunderThor88', method: 'google' }),
      JSON.stringify({ name: 42, method: 'password' }),
    ]) {
      expect(firstScreen(stored)).toEqual({ kind: 'new' });
    }
  });

  it('a stray picture or face in the record is dropped, the greeting stays', () => {
    const stored = JSON.stringify({
      name: 'ThunderThor88',
      avatarUrl: 7,
      face: 'z',
      method: 'facebook',
    });
    expect(firstScreen(stored).player).toEqual({
      name: 'ThunderThor88',
      avatarUrl: null,
      face: null,
      method: 'facebook',
    });
  });
});
