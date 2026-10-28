import { useEffect } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { normalizeFriendSlug } from '@pidro/shared';
import { joinRedirectDestination } from '@/navigation/initialRoute';
import { useAgeGateStore } from '@/stores/ageGate';
import { useAuthStore } from '@/stores/auth';
import { holdFriendLink, usePendingFriendLinkStore } from '@/stores/pendingFriendLink';
import { Background } from '@/components/ui/Background';

/**
 * A player's own link, `pidro.online/play/<slug>`. Signed in, it opens their
 * profile on Friends; without an account it is held until one is made, and
 * that sign-up makes the two of them friends.
 */
export default function PlayLinkRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = normalizeFriendSlug(typeof params.slug === 'string' ? params.slug : '');
  const user = useAuthStore((state) => state.user);
  const linkHydrated = usePendingFriendLinkStore((state) => state.hydrated);
  const ageGateHydrated = useAgeGateStore((state) => state.hydrated);
  const ageBand = useAgeGateStore((state) => state.ageBand);

  useEffect(() => {
    if (!slug || !linkHydrated || !ageGateHydrated) return;
    const destination = joinRedirectDestination(ageBand, user);
    if (destination || user?.guest) {
      holdFriendLink(slug);
      router.replace(destination ?? '/home');
    } else router.replace({ pathname: '/friends', params: { player: slug } });
  }, [ageBand, ageGateHydrated, linkHydrated, router, slug, user]);

  // Only ever on its way elsewhere: the felt shows meanwhile.
  return <Background>{slug ? null : <Redirect href="/+not-found" />}</Background>;
}
