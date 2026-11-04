import { afterEach, expect, test } from 'bun:test';
import { setLocale } from '@pidro/shared';
import {
  NO_NEWS,
  isNewPost,
  newsClosed,
  newsOpened,
  newsReceived,
  postedLine,
} from '../src/features/news.ts';

afterEach(() => setLocale('en'));

const posts = [{ id: 3 }, { id: 2 }, { id: 1 }];

test('the door has a dot while the server counts unread posts, the newest that many marked', () => {
  const state = newsReceived(NO_NEWS, { posts, unread: 2 }, false);
  expect(state.unread).toBe(2);
  expect(posts.map((_, index) => isNewPost(index, state.marked))).toEqual([true, true, false]);
  expect(newsReceived(state, { posts, unread: 0 }, false)).toEqual({ posts, unread: 0, marked: 0 });
});

test('opening clears the dot at once and the cards keep theirs while the sheet is open', () => {
  const opened = newsOpened(newsReceived(NO_NEWS, { posts, unread: 2 }, false));
  expect(opened.unread).toBe(0);
  expect(opened.marked).toBe(2);
  // An answer that lands after Seen says 0; the sheet still shows what was new.
  const late = newsReceived(opened, { posts, unread: 0 }, true);
  expect(late).toEqual({ posts, unread: 0, marked: 2 });
  // The answer to opening may know of one more; the dot stays off.
  expect(newsReceived(opened, { posts, unread: 3 }, true)).toEqual({ posts, unread: 0, marked: 3 });
  expect(newsClosed(late)).toEqual({ posts, unread: 0, marked: 0 });
});

// Local times, so the calendar day is the player's whatever zone the test runs in.
const now = new Date(2026, 10, 4, 9, 30);

test('the date line: Today, Yesterday, then the day and month, the year once it is another', () => {
  expect(postedLine(new Date(2026, 10, 4, 0, 5).toISOString(), now)).toBe('Today');
  expect(postedLine(new Date(2026, 10, 4, 22).toISOString(), now)).toBe('Today');
  // Late last night is yesterday, though fewer than 24 hours ago.
  expect(postedLine(new Date(2026, 10, 3, 23).toISOString(), now)).toBe('Yesterday');
  expect(postedLine(new Date(2026, 10, 2, 12).toISOString(), now)).toBe('November 2');
  expect(postedLine(new Date(2026, 9, 26, 12).toISOString(), now)).toBe('October 26');
  expect(postedLine(new Date(2025, 11, 30, 12).toISOString(), now)).toBe('December 30, 2025');
  expect(postedLine('not a date', now)).toBe('');
  setLocale('sv');
  expect(postedLine(new Date(2026, 10, 4, 8).toISOString(), now)).toBe('I dag');
  expect(postedLine(new Date(2026, 10, 3, 8).toISOString(), now)).toBe('I går');
  expect(postedLine(new Date(2026, 9, 26, 12).toISOString(), now)).toBe('26 oktober');
});
