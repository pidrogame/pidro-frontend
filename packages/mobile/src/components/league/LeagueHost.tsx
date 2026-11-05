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
  refresh: () => Promise<LeagueState | null>;
  setHidden: (hidden: boolean) => Promise<void>;
  resultSeen: (id: string) => Promise<void>;
}>({
  data: null,
  error: false,
  busy: false,
  refresh: async () => null,
  setHidden: async () => {},
  resultSeen: async () => {},
});

/** One server answer shared by the shell and the game. */
export function LeagueHost({ children }: { children: ReactNode }) {
  const token = useAuthStore((state) => state.accessToken);
  return <LeagueSession token={token}>{children}</LeagueSession>;
}

function LeagueSession({ children, token }: { children: ReactNode; token: string | null }) {
  const { fixture } = useGlobalSearchParams<{ fixture?: string }>();
  const preview = useMemo(() => leagueFixture(fixture), [fixture]);
  const path = usePathname();
  const [answer, setAnswer] = useState<{ token: string; data: LeagueState } | null>(null);
  const [errorToken, setErrorToken] = useState<string | null>(null);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [fixtureAnswer, setFixtureAnswer] = useState<{
    fixture?: string;
    data: LeagueState;
  } | null>(null);
  const current = useRef(token);
  const locked = useRef<string | null>(null);
  const refreshPending = useRef(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    if (preview) return preview;
    if (!token) return null;
    if (locked.current === token) {
      refreshPending.current = true;
      return null;
    }
    const version = ++request.current;
    try {
      const data = await leagueApi.get();
      if (current.current === token && request.current === version) {
        setAnswer({ token, data });
        setErrorToken(null);
        if (data.pending_result?.move === 'stayed') {
          await leagueApi.markResultSeen(data.pending_result.id);
          if (current.current === token && request.current === version)
            setAnswer({ token, data: { ...data, pending_result: null } });
        }
        if (current.current === token && request.current === version) return data;
      }
    } catch {
      if (current.current === token && request.current === version) setErrorToken(token);
    }
    return null;
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
    if (!token || locked.current === token) throw new Error('League action unavailable');
    locked.current = token;
    request.current++;
    setBusyToken(token);
    try {
      const result = preview ? undefined : await action();
      if (current.current !== token) throw new Error('League session changed');
      if (preview) setFixtureAnswer({ fixture, data: next(data!) });
      else if (data) setAnswer({ token, data: result ?? next(data) });
      setErrorToken(null);
    } finally {
      if (current.current === token) {
        locked.current = null;
        setBusyToken(null);
        if (refreshPending.current) {
          refreshPending.current = false;
          void refresh();
        }
      }
    }
  };
  return (
    <LeagueContext.Provider
      value={{
        data,
        error: token != null && errorToken === token,
        busy: token != null && busyToken === token,
        refresh,
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
