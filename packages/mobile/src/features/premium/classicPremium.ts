import { getLocale, t, type ClassicPremium } from '@pidro/shared';

/**
 * The one line a claim says about Classic Premium (PID-391): it came with you, or when it
 * ended. Pending, absent and anything unreadable say nothing; who is Premium is the user's.
 */
export function classicPremiumLine(premium: ClassicPremium | null | undefined): string | null {
  if (premium?.state === 'carried') return t('auth.classic_premium_carried');
  if (premium?.state !== 'ended' || !premium.until) return null;
  const until = new Date(premium.until);
  if (Number.isNaN(until.getTime())) return null;
  // "12 March 2026" in English, "12 mars 2026" in Swedish, as Settings' Premium panel.
  const date = new Intl.DateTimeFormat(getLocale() === 'en' ? 'en-GB' : getLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(until);
  return t('auth.classic_premium_ended', { date });
}
