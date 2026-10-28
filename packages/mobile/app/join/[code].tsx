import { useEffect, useMemo } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { isInviteArrivalSource, normalizeInviteCode, type InvitePreview } from '@pidro/shared';
import { JoinInviteScreen } from '@/components/invites/JoinInviteScreen';
import { useAuthStore } from '@/stores/auth';
import { useAgeGateStore } from '@/stores/ageGate';
import { usePendingInviteStore } from '@/stores/pendingInvite';
import { joinRedirectDestination, needsAgeGate } from '@/navigation/initialRoute';
import { Background } from '@/components/ui/Background';

const OPEN_FIXTURE: InvitePreview = {
  code: '7KQ4M2XB',
  state: 'open',
  host: 'Marcel',
  seats_taken: 2,
  seats_total: 4,
  seat_hint: 'partner',
  label: 'Friday game',
  expires_at: '2099-09-03T15:30:00Z',
};

export default function JoinInviteRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; source?: string; fixture?: string }>();
  const code = normalizeInviteCode(typeof params.code === 'string' ? params.code : '');
  const source = isInviteArrivalSource(params.source) ? params.source : undefined;
  const fixture = useMemo(
    (): InvitePreview | null =>
      __DEV__ && ['open', 'finnish', 'louisiana'].includes(params.fixture ?? '')
        ? {
            ...OPEN_FIXTURE,
            code: code ?? '',
            config: {
              name: null,
              solo: false,
              bot_difficulty: 'basic',
              rule_set: params.fixture === 'louisiana' ? 'louisiana' : 'finnish',
            },
          }
        : null,
    [code, params.fixture]
  );
  const authHydrated = useAuthStore((state) => state.hydrated);
  const user = useAuthStore((state) => state.user);
  const pendingInviteHydrated = usePendingInviteStore((state) => state.hydrated);
  const ageGateHydrated = useAgeGateStore((state) => state.hydrated);
  const ageBand = useAgeGateStore((state) => state.ageBand);
  const setPendingInvite = usePendingInviteStore((state) => state.setPendingInvite);

  useEffect(() => {
    if (!code || fixture || !authHydrated || !pendingInviteHydrated || !ageGateHydrated) return;
    const destination = joinRedirectDestination(ageBand, user);
    if (!destination) return;
    setPendingInvite(code, source);
    router.replace(destination);
  }, [
    ageBand,
    ageGateHydrated,
    authHydrated,
    code,
    fixture,
    pendingInviteHydrated,
    router,
    setPendingInvite,
    source,
    user,
  ]);

  if (!code)
    return (
      <Background>
        <Redirect href="/+not-found" />
      </Background>
    );
  if (
    !fixture &&
    (!authHydrated ||
      !pendingInviteHydrated ||
      !ageGateHydrated ||
      !user ||
      needsAgeGate(ageBand, user))
  )
    return <Background />;
  return <JoinInviteScreen key={code} code={code} source={source} fixture={fixture} />;
}
