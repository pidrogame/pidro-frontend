import type { TranslationKey } from '../i18n/catalogs';
import type { BotProfile } from '../types/lobby';

export type BuiltinBotPortrait = 'marcel' | 'antti' | 'jocke';
/** Old servers send only the first four fields; a later one in the wrong shape is left out. */
export function normalizeBotProfiles(value: unknown): BotProfile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (profile): profile is BotProfile =>
        profile != null &&
        typeof profile === 'object' &&
        typeof profile.id === 'string' &&
        typeof profile.name === 'string' &&
        typeof profile.description === 'string' &&
        typeof profile.avatar_url === 'string',
    )
    .map(({ id, name, description, avatar_url, strategy, tempo, home, lines }) => {
      const own = botLines({ lines });
      return {
        id,
        name,
        description,
        avatar_url,
        ...(typeof strategy === 'string' && { strategy }),
        ...(typeof tempo === 'string' && { tempo }),
        ...((home === 'anywhere' || home === 'finland' || home === 'louisiana') && { home }),
        ...(own && { lines: own }),
      };
    });
}

/** A character's own thinking lines, also from a seat's snapshot, which nothing normalizes. */
export function botLines(profile?: { lines?: unknown } | null): string[] | undefined {
  const lines = Array.isArray(profile?.lines)
    ? profile.lines
        .filter((line): line is string => typeof line === 'string' && line.trim() !== '')
        .slice(0, 8)
    : [];
  return lines.length ? lines : undefined;
}

/** The sheet's sentence on how a bot plays: the odds, or the honest game for anything else. */
export function botPlay(strategy: unknown): TranslationKey {
  return strategy === 'search' ? 'bots.play_search' : 'bots.play_rulebook';
}

export function isBuiltinBot(id: unknown): id is BuiltinBotPortrait {
  return id === 'marcel' || id === 'antti' || id === 'jocke';
}

export function resolveBotProfile(
  id: string | null | undefined,
  profile?: BotProfile | null,
  catalogue: readonly BotProfile[] = [],
): BotProfile | null {
  return id ? (profile ?? catalogue.find((bot) => bot.id === id) ?? null) : null;
}

/** Only the server's tracked SVG paths use native drawings. Never send SVG to Image. */
export function botPortrait(
  id: string | null | undefined,
  profile?: BotProfile | null,
  failedUri?: string | null,
):
  | { kind: 'builtin'; persona: BuiltinBotPortrait }
  | { kind: 'remote'; uri: string }
  | { kind: 'neutral' } {
  if (profile?.avatar_url) {
    if (profile.avatar_url === failedUri) return { kind: 'neutral' };
    try {
      const url = new URL(profile.avatar_url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'neutral' };
      const match = /^\/images\/bots\/(marcel|antti|jocke)\.svg$/.exec(url.pathname);
      if (match && isBuiltinBot(match[1])) return { kind: 'builtin', persona: match[1] };
      if (/\.svg$/i.test(url.pathname)) return { kind: 'neutral' };
      return { kind: 'remote', uri: profile.avatar_url };
    } catch {
      return { kind: 'neutral' };
    }
  }
  return isBuiltinBot(id) ? { kind: 'builtin', persona: id } : { kind: 'neutral' };
}

export function builtinBotName(id: unknown): string | null {
  return isBuiltinBot(id) ? { marcel: 'Marcel', antti: 'Antti', jocke: 'Jocke' }[id] : null;
}
