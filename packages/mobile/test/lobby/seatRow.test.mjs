import { describe, expect, it } from 'bun:test';
import { setLocale } from '@pidro/shared';
import { seatRow } from '../../src/features/lobby/seatRow';

const maija = { user_id: 'u_maija', display_name: 'Maija', avatar_url: null };
const words = (seat) => {
  const row = seatRow({ team: 'opponent', opened: false, type: 'open', ...seat });
  return [row.name, row.status, row.statusTone];
};

describe('before the table opens', () => {
  it('names an open seat and what it asks for', () => {
    expect(words({})).toEqual(['Open seat', 'Anyone can sit', 'soft']);
    expect(words({ min_games: 100 })).toEqual(['Open seat', '100+ games played', 'soft']);
    expect(words({ min_games: 1000 })).toEqual(['Open seat', '1000+ games played', 'soft']);
    expect(words({ password: '4821' })).toEqual(['Open seat', 'Password 4821', 'gold']);
  });

  it('badges the chair with the games level, or a lock when there is a password', () => {
    expect(seatRow({ team: 'partner', opened: false, type: 'open' }).token).toEqual({
      kind: 'open',
      badge: null,
      locked: false,
    });
    expect(
      seatRow({ team: 'partner', opened: false, type: 'open', min_games: 100 }).token.badge
    ).toBe('100');
    expect(
      seatRow({ team: 'partner', opened: false, type: 'open', min_games: 1000 }).token.badge
    ).toBe('1k');
    expect(
      seatRow({ team: 'partner', opened: false, type: 'open', min_games: 100, password: '4821' })
        .token
    ).toEqual({ kind: 'open', badge: null, locked: true });
  });

  it('says anyone sits in a bot seat until the host chooses who, then shows them', () => {
    const row = seatRow({ team: 'opponent', opened: false, type: 'ai' });
    expect([row.name, row.status, row.nameTone]).toEqual(['Anyone', 'Whoever turns up', 'default']);
    expect(row.token).toEqual({ kind: 'bot', persona: null });
    const gun = {
      id: 'gun',
      name: 'Gun',
      description: 'Korsholm. Taught half the village to play.',
      avatar_url: 'https://fixture.invalid/gun.jpg',
      strategy: 'rulebook',
      tempo: 'steady',
      home: 'finland',
    };
    const chosen = seatRow({ team: 'partner', opened: false, type: 'ai', bot: gun });
    expect([chosen.name, chosen.status, chosen.statusTone]).toEqual(['Gun', 'Korsholm · steady', 'soft']);
    expect(chosen.token).toEqual({ kind: 'bot', persona: 'gun', botProfile: gun });
    // A character who plays the odds says so in gold, without the town or tempo.
    const antti = { ...gun, id: 'antti', name: 'Antti', description: '', strategy: 'search', tempo: 'slow', home: 'anywhere' };
    const odds = seatRow({ team: 'opponent', opened: false, type: 'ai', bot: antti });
    expect([odds.name, odds.status, odds.statusTone]).toEqual(['Antti', '★ Plays the odds', 'gold']);
    try {
      setLocale('sv');
      expect(seatRow({ team: 'partner', opened: false, type: 'ai', bot: gun }).status).toBe('Korsholm · stadig');
      expect(seatRow({ team: 'partner', opened: false, type: 'ai' }).name).toBe('Vem som helst');
    } finally {
      setLocale('en');
    }
  });

  it('says a chosen friend is invited once the table opens', () => {
    const row = seatRow({ team: 'partner', opened: false, type: 'held', held_for: maija });
    expect([row.name, row.status, row.nameTone, row.statusTone]).toEqual([
      'Maija',
      'Invited when you open the table',
      'gold',
      'gold',
    ]);
    expect(row.token).toEqual({ kind: 'friend', uri: null });
    expect(row.label).toBe('Partner: Maija, Invited when you open the table. Change');
  });

  it('shows the host as You, not tappable', () => {
    const row = seatRow({
      team: 'you',
      opened: false,
      type: 'held',
      player: { username: 'bengt' },
    });
    expect([row.name, row.status, row.tappable, row.label]).toEqual([
      'You',
      'Host',
      false,
      'You, the host',
    ]);
  });
});

describe('after the table opens', () => {
  it('waits on open seats, repeating the password', () => {
    expect(words({ opened: true })).toEqual(['Open seat', 'Waiting…', 'soft']);
    expect(words({ opened: true, min_games: 100 })).toEqual(['Open seat', 'Waiting…', 'soft']);
    expect(words({ opened: true, password: '4821' })).toEqual([
      'Open seat',
      'Waiting… · password 4821',
      'gold',
    ]);
  });

  it('says whether an invited friend can answer yet', () => {
    const held = { opened: true, type: 'held', held_for: maija };
    expect(words({ ...held, presence: 'online' })[1]).toBe('Invited · waiting for an answer');
    expect(words({ ...held, presence: 'at_table' })[1]).toBe('Invited · waiting for an answer');
    expect(words({ ...held, presence: 'offline' })[1]).toBe('Invited · not online yet');
    expect(words({ ...held })[1]).toBe('Invited · not online yet');
  });

  it('shows anyone seated as ready, whatever the seat was', () => {
    const kalle = { id: 'u_kalle', username: 'Kalle', avatar_url: 'k.png' };
    const row = seatRow({
      team: 'opponent',
      opened: true,
      type: 'held',
      held_for: maija,
      player: kalle,
    });
    expect([row.name, row.status, row.statusTone, row.nameTone]).toEqual([
      'Kalle',
      'Ready',
      'ready',
      'default',
    ]);
    expect(row.token).toEqual({ kind: 'player', uri: 'k.png' });
    expect(seatRow({ team: 'partner', opened: true, type: 'open', player: kalle }).nameTone).toBe(
      'gold'
    );

    const bot = seatRow({
      team: 'opponent',
      opened: true,
      type: 'ai',
      player: {
        id: 'bot_1',
        username: 'bot_1',
        display_name: 'Antti',
        is_bot: true,
        bot_persona: 'antti',
      },
    });
    expect([bot.name, bot.status]).toEqual(['Antti', 'Ready']);
    expect(bot.token).toEqual({ kind: 'bot', persona: 'antti' });
  });

  it('keeps open seats cyan, even on your team', () => {
    expect(seatRow({ team: 'partner', opened: true, type: 'open' }).nameTone).toBe('cyan');
  });

  it('shows a dropped player quietly, even if they were ready, until they return', () => {
    const seat = { opened: true, player: { id: 'pedro', username: 'Pedro1' }, ready: true };
    expect(words({ ...seat, connectionStatus: 'reconnecting' })).toEqual([
      'Pedro1', 'Reconnecting…', 'soft',
    ]);
    expect(words({ ...seat, connectionStatus: 'normal' })).toEqual(['Pedro1', 'Ready', 'ready']);
    expect(words({ ...seat, team: 'you', connectionStatus: 'reconnecting' })).toEqual([
      'You', 'Reconnecting…', 'soft',
    ]);
    try {
      setLocale('sv');
      expect(words({ ...seat, connectionStatus: 'reconnecting' })[1]).toBe('Återansluter…');
    } finally { setLocale('en'); }
  });
});

it('speaks Swedish', () => {
  try {
    setLocale('sv');
    expect(words({ min_games: 1000 })).toEqual(['Ledig plats', '1000+ spelade spel', 'soft']);
    expect(words({ opened: true, password: '4821' })[1]).toBe('Väntar… · lösenord 4821');
    expect(seatRow({ team: 'partner', opened: true, type: 'held', held_for: maija }).label).toBe(
      'Partner: Maija, Inbjuden · inte online än. Ändra'
    );
  } finally {
    setLocale('en');
  }
});
