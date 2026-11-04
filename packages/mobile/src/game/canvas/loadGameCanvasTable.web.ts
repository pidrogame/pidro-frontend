import type { ComponentProps, ComponentType } from 'react';
import type { GameCanvasTable } from './GameCanvasTable';

type GameCanvasTableComponent = typeof GameCanvasTable;

let table: Promise<ComponentType<ComponentProps<GameCanvasTableComponent>>> | null = null;

/** Loads CanvasKit and the table once, and starts decoding its card textures and sounds. */
export function loadGameCanvasTable() {
  table ??= load().catch((error) => {
    table = null;
    throw error;
  });
  return table;
}

async function load(): Promise<ComponentType<ComponentProps<GameCanvasTableComponent>>> {
  const skiaWeb = await import('@shopify/react-native-skia/lib/module/web');
  await skiaWeb.LoadSkiaWeb({ locateFile: (file) => `/${file}` });
  const module = await import('./GameCanvasTable');
  void (await import('./cardTextures')).preloadCardTextures();
  (await import('../sounds')).preloadSounds();
  return module.GameCanvasTable;
}
