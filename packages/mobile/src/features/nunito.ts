/** The static Nunito files Android loads, one family per weight the app uses. */
export const NUNITO_STATIC = {
  500: 'Nunito-Medium',
  600: 'Nunito-SemiBold',
  700: 'Nunito-Bold',
  800: 'Nunito-ExtraBold',
  900: 'Nunito-Black',
} as const;

/**
 * Nunito's family for a final weight. iPhone and web draw every weight from the
 * one variable file. Android registers a font loaded at run time under a single
 * weight: asked for bold it falls back to Roboto, and anything lighter gets the
 * variable file's default, ExtraLight. So there each weight is its own family,
 * drawn with fontWeight normal; a weight the app does not use gets the nearest one.
 */
export function nunitoFamily(platform: string, weight?: string | number): string {
  if (platform !== 'android') return 'Nunito';
  const asked = weight === 'bold' ? 700 : Number(weight) || 400;
  const nearest = Math.min(900, Math.max(500, Math.round(asked / 100) * 100));
  return NUNITO_STATIC[nearest as keyof typeof NUNITO_STATIC];
}
