import type { TranslationEntry } from '../catalogs';

// Table personas, not biographies. Keep both languages here for quick copy edits.
export const en = {
  'bots.title': 'Bot at the table',
  'bots.marcel.play':
    'All three bots play the same honest game: they bid only as high as they need to, count trumps and back up their partner.',
  'bots.marcel.saying': '“One hand at a time.”',
  'bots.marcel.thinking_1': 'Hmm, jaha…',
  'bots.marcel.thinking_2': 'Let’s see…',
  'bots.marcel.thinking_3': 'Counting…',
  'bots.marcel.thinking_4': 'Nå…',
  'bots.antti.play':
    'All three bots play the same honest game: they bid only as high as they need to, count trumps and back up their partner.',
  'bots.antti.saying': '“No hurry.”',
  'bots.antti.thinking_1': 'Hmm…',
  'bots.antti.thinking_2': 'One moment…',
  'bots.antti.thinking_3': 'Väntä lite…',
  'bots.antti.thinking_4': 'Which one…',
  'bots.jocke.play':
    'All three bots play the same honest game: they bid only as high as they need to, count trumps and back up their partner.',
  'bots.jocke.saying': '“There’s a hand left.”',
  'bots.jocke.thinking_1': 'Nå, jaha…',
  'bots.jocke.thinking_2': 'Maybe this…',
  'bots.jocke.thinking_3': 'Let me think…',
  'bots.jocke.thinking_4': 'A trump…',
} as const satisfies Record<string, TranslationEntry>;

export const sv = {
  'bots.title': 'Bot vid bordet',
  'bots.marcel.play':
    'Alla tre botarna spelar samma ärliga spel: de bjuder bara så högt som behövs, räknar trumf och stöttar sin partner.',
  'bots.marcel.saying': '“En giv i taget.”',
  'bots.marcel.thinking_1': 'Hmm, jaha…',
  'bots.marcel.thinking_2': 'Ska vi se…',
  'bots.marcel.thinking_3': 'Räknar trumf…',
  'bots.marcel.thinking_4': 'Nå…',
  'bots.antti.play':
    'Alla tre botarna spelar samma ärliga spel: de bjuder bara så högt som behövs, räknar trumf och stöttar sin partner.',
  'bots.antti.saying': '“Ingen brådska.”',
  'bots.antti.thinking_1': 'Hmm…',
  'bots.antti.thinking_2': 'Ett ögonblick…',
  'bots.antti.thinking_3': 'Väntä lite…',
  'bots.antti.thinking_4': 'Vilken nu då…',
  'bots.jocke.play':
    'Alla tre botarna spelar samma ärliga spel: de bjuder bara så högt som behövs, räknar trumf och stöttar sin partner.',
  'bots.jocke.saying': '“Det finns en giv kvar.”',
  'bots.jocke.thinking_1': 'Nå, jaha…',
  'bots.jocke.thinking_2': 'Kanske den här…',
  'bots.jocke.thinking_3': 'Ska tänka lite…',
  'bots.jocke.thinking_4': 'Trumf, månne…',
} as const satisfies Record<keyof typeof en, TranslationEntry>;
