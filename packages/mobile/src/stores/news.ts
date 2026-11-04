import { getLocale, type Locale } from '@pidro/shared';
import { create } from 'zustand';
import { newsApi } from '@/api/news';
import { NO_NEWS, newsClosed, newsOpened, newsReceived, type NewsState } from '@/features/news';
import { authStore } from './auth';

interface NewsStore extends NewsState {
  open: boolean;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  fetchedAt: number;
  /** The posts' language: another one makes them stale. */
  locale: Locale | null;
}

/** The posts and what is new, from `GET /api/v1/news` (PID-347). */
export const useNewsStore = create<NewsStore>(() => ({
  ...NO_NEWS,
  open: false,
  status: 'idle',
  fetchedAt: 0,
  locale: null,
}));

authStore.subscribe((state, previous) => {
  if (state.accessToken !== previous.accessToken)
    useNewsStore.setState({ ...NO_NEWS, open: false, status: 'idle', fetchedAt: 0, locale: null });
});

/** Counts the openings, so an answer asked for before one never brings its dot back. */
let openings = 0;

/** Asks again unless the last answer is younger than `maxAge`. */
export async function loadNews({ maxAge = 0, opening = false } = {}) {
  const { fetchedAt, status, locale: shown } = useNewsStore.getState();
  if (!authStore.getState().accessToken) return;
  const locale = getLocale();
  const fresh = shown === locale && Date.now() - fetchedAt < maxAge;
  if (!opening && (status === 'loading' || fresh)) return;
  const token = authStore.getState().accessToken;
  const asked = openings;
  useNewsStore.setState({ status: 'loading', fetchedAt: Date.now() });
  try {
    const page = await newsApi.list(locale);
    if (token !== authStore.getState().accessToken) return;
    // Asked before Seen, its count is old: it never brings the dot back once closed.
    const before = asked !== openings || opening;
    useNewsStore.setState((state) => ({
      status: 'ready',
      locale,
      ...(state.open
        ? newsReceived(state, page, true)
        : before
          ? { posts: page.posts }
          : newsReceived(state, page, false)),
    }));
  } catch {
    if (token === authStore.getState().accessToken) useNewsStore.setState({ status: 'failed' });
  }
}

/** Opening the sheet: the dot goes at once, a fresh answer, then the server hears it was seen. */
export async function openNews() {
  openings++;
  useNewsStore.setState((state) => ({ ...newsOpened(state), open: true }));
  await loadNews({ opening: true });
  if (useNewsStore.getState().status === 'ready') await newsApi.seen().catch(() => undefined);
}

export function closeNews() {
  useNewsStore.setState((state) => ({ ...newsClosed(state), open: false }));
}
