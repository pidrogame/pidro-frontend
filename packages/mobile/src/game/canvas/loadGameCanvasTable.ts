import type { ComponentProps, ComponentType } from 'react';
import type { GameCanvasTable } from './GameCanvasTable';

type GameCanvasTableComponent = typeof GameCanvasTable;

let table: Promise<ComponentType<ComponentProps<GameCanvasTableComponent>>> | null = null;

/** Loads the table once, and starts decoding its card textures; the waiting room calls it early. */
export function loadGameCanvasTable() {
  table ??= load().catch((error) => {
    table = null;
    throw error;
  });
  return table;
}

async function load(): Promise<ComponentType<ComponentProps<GameCanvasTableComponent>>> {
  // Keep the native table in Metro's initial module graph so a development
  // server restart cannot leave an older Expo Go runtime requesting a lazy
  // chunk with incompatible module IDs. `require` still defers evaluation until
  // the waiting room or the game asks; web keeps its CanvasKit-first dynamic loader.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const module = require('./GameCanvasTable') as typeof import('./GameCanvasTable');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  void (require('./cardTextures') as typeof import('./cardTextures')).preloadCardTextures();
  return module.GameCanvasTable;
}
