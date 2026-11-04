import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import type { LeagueState } from '@pidro/shared';
import { leagueApi } from '@/api/league';
import { leagueFixture } from '@/features/leagueFixtures';
import { useAuthStore } from '@/stores/auth';

const LeagueContext = createContext<{
  data: LeagueState | null;
  error: boolean;
  busy: boolean;
  refresh: () => Promise<void>;
  introSeen: () => Promise<void>;
  setHidden: (hidden: boolean) => Promise<void>;
  resultSeen: (id: string) => Promise<void>;
}>({
  data: null,
  error: false,
  busy: false,
  refresh: async () => {},
  introSeen: async () => {},
  setHidden: async () => {},
  resultSeen: async () => {},
});

/** One server answer for the shell. Nothing authoritative is persisted on the device. */
export function LeagueHost({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.accessToken);
  return (
    <LeagueSession key={token} token={token}>
      {children}
    </LeagueSession>
  );
}

function LeagueSession({ children, token }: { children: ReactNode; token: string | null }) {
  const { fixture } = useGlobalSearchParams<{ fixture?: string }>();
  const preview = useMemo(() => leagueFixture(fixture), [fixture]);
  const path = usePathname();
  const [answer, setAnswer] = useState<{ token: string; data: LeagueState } | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fixtureAnswer, setFixtureAnswer] = useState<{
    fixture?: string;
    data: LeagueState;
  } | null>(null);
  const current = useRef(token);
  const locked = useRef(false);
  const refreshPending = useRef(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    if (!token || preview) return;
    if (locked.current) {
      refreshPending.current = true;
      return;
    }
    const version = ++request.current;
    try {
      const data = await leagueApi.get();
      if (current.current === token && request.current === version) {
        setAnswer({ token, data });
        setError(false);
      }
    } catch {
      if (current.current === token && request.current === version) setError(true);
    }
  }, [token, preview]);
  useEffect(() => {
    current.current = token;
    return () => {
      current.current = null;
    };
  }, [token]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh awaits the server before setting state
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh, path]);
  const data = preview
    ? fixtureAnswer && fixtureAnswer.fixture === fixture
      ? fixtureAnswer.data
      : preview
    : answer?.token === token
      ? answer.data
      : null;
  const mutate = async (
    action: () => Promise<LeagueState | void>,
    next: (data: LeagueState) => LeagueState
  ) => {
    if (locked.current || !token) throw new Error('League action unavailable');
    locked.current = true;
    request.current++;
    setBusy(true);
    try {
      const result = preview ? undefined : await action();
      if (current.current !== token) throw new Error('League session changed');
      if (preview) setFixtureAnswer({ fixture, data: next(data!) });
      else if (data) setAnswer({ token, data: result ?? next(data) });
      setError(false);
    } finally {
      locked.current = false;
      setBusy(false);
      if (refreshPending.current) {
        refreshPending.current = false;
        void refresh();
      }
    }
  };
  return (
    <LeagueContext.Provider
      value={{
        data,
        error,
        busy,
        refresh,
        introSeen: () =>
          mutate(
            () => leagueApi.introSeen(),
            (state) => ({ ...state, intro_seen: true })
          ),
        resultSeen: (id) =>
          mutate(
            () => leagueApi.markResultSeen(id),
            (state) => ({
              ...state,
              pending_result: state.pending_result?.id === id ? null : state.pending_result,
            })
          ),
        setHidden: (hidden) =>
          mutate(
            () => leagueApi.setHidden(hidden),
            (state) => ({
              ...state,
              status: hidden ? 'opted_out' : 'not_placed',
              room: null,
              me: null,
              friends: [],
            })
          ),
      }}>
      {children}
    </LeagueContext.Provider>
  );
}

export const useLeague = () => useContext(LeagueContext);
