import { formatDate, t, type NewsPage, type NewsPost } from '@pidro/shared';

/**
 * News on Home (PID-347). The server counts the posts the player has not seen;
 * they are the newest, so the first `marked` posts wear a dot. `unread` drives
 * the dot on the door and clears the moment the sheet opens; `marked` keeps the
 * cards' dots while it is open, so the player sees which posts were new.
 */
export interface NewsState {
  posts: NewsPost[];
  unread: number;
  marked: number;
}

export const NO_NEWS: NewsState = { posts: [], unread: 0, marked: 0 };

/** An answer from the server. While the sheet is open it is seen already, whatever it says. */
export function newsReceived(state: NewsState, page: NewsPage, open: boolean): NewsState {
  if (open) return { posts: page.posts, unread: 0, marked: Math.max(state.marked, page.unread) };
  return { posts: page.posts, unread: page.unread, marked: page.unread };
}

/** The sheet opens: the door's dot goes at once, the cards keep theirs. */
export function newsOpened(state: NewsState): NewsState {
  return { ...state, unread: 0, marked: Math.max(state.marked, state.unread) };
}

/** Closed again, nothing is new any more. */
export function newsClosed(state: NewsState): NewsState {
  return { ...state, unread: 0, marked: 0 };
}

export const isNewPost = (index: number, marked: number) => index < marked;

const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "Today", "Yesterday", else the day and month, with the year once it is another year. */
export function postedLine(value: string, now: Date = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days <= 0) return t('news.postedToday');
  if (days === 1) return t('news.postedYesterday');
  return formatDate(
    date,
    date.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' }
  );
}

/** Dated from now, so Today reads Today on every day. */
function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

const FIXTURE_POSTS: NewsPost[] = [
  {
    id: 3,
    title: 'The table sounds like Pidro again',
    body: 'The card, the shuffle, the deal, your turn: the sounds you know from the old game. Rather play quietly? Settings → Sound.',
    published_at: daysAgo(0),
  },
  {
    id: 2,
    title: 'Bigger cards, a calmer table',
    body: 'Your cards are bigger and stand upright. Bots play at the old pace, and the seats stay quiet while a hand is on.',
    published_at: daysAgo(0),
  },
  {
    id: 1,
    title: 'Welcome to the new Pidro',
    body: 'This is a test version. You are one of the first to play it, and it is still being built.\nHere today: Finnish and Louisiana rules, tables with friends, bots that fill an empty chair.\nYour old Pidro app keeps working. Nothing there changes.',
    published_at: '2026-10-26T08:00:00Z',
  },
];

/**
 * Dev fixtures `?fixture=news-<state>` on Home: `home` shows the door with new posts and
 * friends online, `request` a friend request and nothing new; `sheet`, `reply`, `empty`
 * and `error` open the sheet. The newest post shows `image`, the oldest an image that fails.
 */
export function newsFixture(fixture: string | undefined, image?: string) {
  if (!__DEV__ || !fixture?.startsWith('news-')) return null;
  const state = fixture.slice('news-'.length);
  const empty = state === 'empty' || state === 'error';
  // Doors-Home-Req: the request waits with nothing new to read.
  const unread = empty || state === 'request' ? 0 : 2;
  const [newest, middle, oldest] = FIXTURE_POSTS;
  const posts = [
    { ...newest, image_url: image },
    middle,
    { ...oldest, image_url: 'https://example.invalid/news.png' },
  ];
  return {
    news: { posts: empty ? [] : posts, unread, marked: unread },
    failed: state === 'error',
    open: ['sheet', 'reply', 'empty', 'error'].includes(state),
    reply: state === 'reply' ? FIXTURE_POSTS[0] : null,
    online: state === 'home' || state === 'request' ? 2 : 0,
    requests: state === 'request' ? 1 : 0,
  };
}
