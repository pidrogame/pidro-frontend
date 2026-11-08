import type { BuiltinBotPortrait, TranslationKey } from '@pidro/shared';

// The copy lives together in shared/src/i18n/sections/bots.ts (English and Swedish).
export const botPersonas = {
  marcel: {
    name: 'Marcel',
    saying: 'bots.marcel.saying',
    thinking: [
      'bots.marcel.thinking_1',
      'bots.marcel.thinking_2',
      'bots.marcel.thinking_3',
      'bots.marcel.thinking_4',
    ],
  },
  antti: {
    name: 'Antti',
    saying: 'bots.antti.saying',
    thinking: [
      'bots.antti.thinking_1',
      'bots.antti.thinking_2',
      'bots.antti.thinking_3',
      'bots.antti.thinking_4',
    ],
  },
  jocke: {
    name: 'Jocke',
    saying: 'bots.jocke.saying',
    thinking: [
      'bots.jocke.thinking_1',
      'bots.jocke.thinking_2',
      'bots.jocke.thinking_3',
      'bots.jocke.thinking_4',
    ],
  },
} as const satisfies Record<
  BuiltinBotPortrait,
  {
    name: string;
    saying: TranslationKey;
    thinking: readonly TranslationKey[];
  }
>;
