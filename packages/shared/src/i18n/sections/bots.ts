import type { TranslationEntry } from '../catalogs';

// Table personas, not biographies. Keep both languages here for quick copy edits.
export const en = {
  'bots.title': 'Bot at the table',
  'bots.play_rulebook':
    'Plays the honest game: bids only as high as it needs to, counts trumps and backs up its partner.',
  'bots.play_search':
    'Plays the odds: deals out the cards it can’t see and takes the line that wins most often, yet still bids only what the contract needs.',
  'bots.marcel.saying': '“One hand at a time.”',
  'bots.marcel.thinking_1': 'Hmm, jaha…',
  'bots.marcel.thinking_2': 'Let’s see…',
  'bots.marcel.thinking_3': 'Counting…',
  'bots.marcel.thinking_4': 'Nå…',
  'bots.antti.saying': '“No hurry.”',
  'bots.antti.thinking_1': 'Hmm…',
  'bots.antti.thinking_2': 'One moment…',
  'bots.antti.thinking_3': 'Väntä lite…',
  'bots.antti.thinking_4': 'Which one…',
  'bots.jocke.saying': '“There’s a hand left.”',
  'bots.jocke.thinking_1': 'Nå, jaha…',
  'bots.jocke.thinking_2': 'Maybe this…',
  'bots.jocke.thinking_3': 'Let me think…',
  'bots.jocke.thinking_4': 'A trump…',
  'bots.tempo_quick': 'quick',
  'bots.tempo_steady': 'steady',
  'bots.tempo_slow': 'slow',
  'bots.region_finnish': 'Ostrobothnia',
  'bots.region_louisiana': 'Acadiana',
} as const satisfies Record<string, TranslationEntry>;

export const sv = {
  'bots.title': 'Bot vid bordet',
  'bots.play_rulebook':
    'Spelar ett ärligt spel: bjuder bara så högt som behövs, räknar trumf och stöttar sin partner.',
  'bots.play_search':
    'Spelar på oddsen: delar ut korten den inte ser och väljer det spel som vinner oftast, men bjuder ändå bara vad kontraktet kräver.',
  'bots.marcel.saying': '“En giv i taget.”',
  'bots.marcel.thinking_1': 'Hmm, jaha…',
  'bots.marcel.thinking_2': 'Ska vi se…',
  'bots.marcel.thinking_3': 'Räknar trumf…',
  'bots.marcel.thinking_4': 'Nå…',
  'bots.antti.saying': '“Ingen brådska.”',
  'bots.antti.thinking_1': 'Hmm…',
  'bots.antti.thinking_2': 'Ett ögonblick…',
  'bots.antti.thinking_3': 'Väntä lite…',
  'bots.antti.thinking_4': 'Vilken nu då…',
  'bots.jocke.saying': '“Det finns en giv kvar.”',
  'bots.jocke.thinking_1': 'Nå, jaha…',
  'bots.jocke.thinking_2': 'Kanske den här…',
  'bots.jocke.thinking_3': 'Ska tänka lite…',
  'bots.jocke.thinking_4': 'Trumf, månne…',
  'bots.tempo_quick': 'snabb',
  'bots.tempo_steady': 'stadig',
  'bots.tempo_slow': 'långsam',
  'bots.region_finnish': 'Österbotten',
  'bots.region_louisiana': 'Acadiana',
} as const satisfies Record<keyof typeof en, TranslationEntry>;
