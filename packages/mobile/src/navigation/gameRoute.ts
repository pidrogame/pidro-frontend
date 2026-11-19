export type GameOrigin = 'single-player';

export function parseGameOrigin(value: unknown): GameOrigin | undefined {
  return value === 'single-player' ? value : undefined;
}

export function gameExitPath(origin: GameOrigin | undefined): '/home' | '/lobby' {
  return origin === 'single-player' ? '/home' : '/lobby';
}

/** `again`: the player already said ready, with Play again at the table before (PID-478). */
export function gameRoute(code: string, origin?: GameOrigin, again = false) {
  return {
    pathname: '/game/[code]' as const,
    params: { code, ...(origin ? { origin } : {}), ...(again ? { again: '1' } : {}) },
  };
}
