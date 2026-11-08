import { afterEach, describe, expect, it } from 'bun:test';
import { setLocale } from '@pidro/shared';
import { catalogs } from '../../../shared/src/i18n/catalogs.ts';
import { botPersonas } from '../../src/components/ui/botPersonas.ts';
import { handHeadlines, tableLine, thinkingLine } from '../../src/features/game/tableVoice.ts';

afterEach(() => setLocale('en'));

describe('the table’s voice', () => {
  const sets = [
    ...Object.values(handHeadlines),
    ...Object.values(botPersonas).map((bot) => bot.thinking),
  ];

  it('gives the same room and hand the same line, with a spread across hands and rooms', () => {
    for (const lines of sets) {
      const picks = Array.from({ length: 1000 }, (_, hand) => tableLine('7KQ4M2XB', hand, lines));
      expect(picks).toEqual(
        Array.from({ length: 1000 }, (_, hand) => tableLine('7KQ4M2XB', hand, lines))
      );
      expect(new Set(picks)).toEqual(new Set(lines));
      expect(picks).not.toEqual(
        Array.from({ length: 1000 }, (_, hand) => tableLine('OTHER', hand, lines))
      );
    }
    const picks = Array.from({ length: 1000 }, (_, hand) =>
      tableLine('7KQ4M2XB', hand, handHeadlines['we-made'], 'result')
    );
    const familiar = picks.filter((key) => key === 'game.we_made_it').length;
    expect(familiar).toBeGreaterThan(500);
    expect(familiar).toBeLessThan(700);
  });

  it('has every persona and line in both languages, retaining the missed amount', () => {
    for (const locale of ['en', 'sv']) {
      for (const lines of sets)
        for (const key of lines) {
          expect(typeof catalogs[locale][key]).toBe('string');
          expect(catalogs[locale][key].length).toBeGreaterThan(0);
        }
      for (const bot of Object.values(botPersonas)) {
        expect(catalogs[locale][bot.saying].length).toBeGreaterThan(0);
        for (const key of bot.thinking)
          expect(catalogs[locale][key].length).toBeLessThanOrEqual(17);
      }
      for (const outcome of ['we-missed', 'they-missed', 'missed']) {
        for (const key of handHeadlines[outcome]) expect(catalogs[locale][key]).toContain('%{n}');
      }
    }
  });
});

describe('a bot thinking aloud on its turn', () => {
  const saga = {
    id: '1c477a6a-fb56-4b4f-a6b5-3b1390c60102',
    name: 'Saga',
    description: '',
    avatar_url: 'https://backend.example/images/bots/antti.svg',
  };
  const lines = ['Nå, nå…', 'Tja…', 'Hmm, hmm…'];
  const hands = Array.from({ length: 200 }, (_, hand) => hand);

  it('says a catalogue character’s own lines, in every language, the same for every phone', () => {
    const picks = hands.map((hand) => thinkingLine('DEV01', hand, saga.id, { ...saga, lines }));
    expect(new Set(picks)).toEqual(new Set(lines));
    setLocale('sv');
    expect(hands.map((hand) => thinkingLine('DEV01', hand, saga.id, { ...saga, lines }))).toEqual(
      picks
    );
  });

  it('keeps the three devs exactly as before until the catalogue gives them lines', () => {
    // The lines the bot-crew fixture (room DEV01, hand 4) has always shown.
    expect(thinkingLine('DEV01', 4, 'marcel')).toBe('Let’s see…');
    expect(thinkingLine('DEV01', 4, 'antti', { ...saga, id: 'antti', name: 'Antti' })).toBe(
      'One moment…'
    );
    expect(thinkingLine('DEV01', 4, 'jocke', { ...saga, lines: [] })).toBe('A trump…');
    setLocale('sv');
    expect(thinkingLine('DEV01', 4, 'jocke', null)).toBe('Trumf, månne…');
    expect(thinkingLine('DEV01', 4, 'marcel', { ...saga, lines })).toBe(
      tableLine('DEV01', 4, lines, 'marcel')
    );
    expect(lines).toContain(thinkingLine('DEV01', 4, 'marcel', { ...saga, lines }));
  });

  it('leaves the plain turn text to a character with no lines, and to a person', () => {
    expect(thinkingLine('DEV01', 4, saga.id, saga)).toBeNull();
    expect(thinkingLine('DEV01', 4, saga.id, { ...saga, lines: 'Nå…' })).toBeNull();
    expect(thinkingLine('DEV01', 4, 'unknown')).toBeNull();
    expect(thinkingLine('DEV01', 4, null, { ...saga, lines })).toBeNull();
  });
});
