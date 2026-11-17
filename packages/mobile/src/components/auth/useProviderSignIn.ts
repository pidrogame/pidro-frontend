import { useCallback, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import type { AuthProvider } from '@/api/auth';
import { captureAnalytics } from '@/analytics/PostHogAnalytics';
import { signInEvent } from '@/features/analytics';
import { handleClassicFound } from '@/features/auth/classicFound';
import { signInOutcome } from '@/features/auth/signInOutcome';
import { handleSocialSignInOutcome } from '@/features/auth/loginSocial';
import type { SocialSignInOutcome } from '@/hooks/useAuth';
import { authenticatedEntryDestination } from '@/navigation/initialRoute';
import { useAgeGateStore } from '@/stores/ageGate';
import { usePendingInviteStore } from '@/stores/pendingInvite';
import { useTranslation } from '@/i18n';

/**
 * Apple or Facebook, from any screen that offers them. The same three
 * answers everywhere: signed in, a Classic account to confirm, or an identity
 * we could not use.
 */
export function useProviderSignIn(
  signInWithProvider: (provider: AuthProvider) => Promise<SocialSignInOutcome>
) {
  const { t } = useTranslation();
  const router = useRouter();
  const pendingInvite = usePendingInviteStore((state) => state.pendingInvite);
  const [notice, setNotice] = useState<string | null>(null);

  const start = useCallback(
    async (provider: AuthProvider) => {
      setNotice(null);
      captureAnalytics('sign_in_started', { method: provider });
      const outcome = await signInWithProvider(provider);
      captureAnalytics(...signInEvent(provider, signInOutcome(outcome)));
      handleSocialSignInOutcome(outcome, {
        onSignedIn: () => {
          if (outcome.status !== 'signed_in') return;
          router.replace(
            authenticatedEntryDestination(
              pendingInvite,
              useAgeGateStore.getState().ageBand,
              outcome.session.user
            ) as Href
          );
        },
        onClassicFound: (claim) => {
          handleClassicFound(claim, provider);
          router.replace('/(auth)/claim-classic');
        },
        onUnknownIdentity: () => setNotice(provider === 'apple' ? 'Apple' : 'Facebook'),
      });
    },
    [pendingInvite, router, signInWithProvider]
  );

  return { start, notice: notice ? t('auth.social_unknown', { provider: notice }) : null };
}
