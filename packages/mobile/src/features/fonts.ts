/**
 * After a font fails, the app still starts. This settles once the fonts still loading
 * have loaded or failed, so the first screen draws with every face that loaded and the
 * system face for the rest, and gives back any further failures. The failed font is not
 * tried again.
 */
export async function settleFonts<Source>(
  fonts: Record<string, Source>,
  loader: {
    isLoading: (name: string) => boolean;
    loadAsync: (name: string, source: Source) => Promise<void>;
  }
): Promise<unknown[]> {
  const loading = Object.keys(fonts).filter((name) => loader.isLoading(name));
  // On a phone a family still loading hands back its load in flight, not a new one.
  const results = await Promise.allSettled(
    loading.map((name) => loader.loadAsync(name, fonts[name]))
  );
  return results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
}
