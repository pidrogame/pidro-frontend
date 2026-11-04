import { expect, test } from 'bun:test';
import { friendsTabCount, onlineCount, waitingCount } from '../../src/features/friends/waitingCount.ts';

test('waiting is incoming requests plus live seats, not sent requests or friends', () => {
  const lists = {
    requests_waiting: 2,
    added_you: [{}, {}, {}, {}],
    friends: [{}],
    requested: [{}],
  };
  expect(waitingCount(lists, [{}, {}, {}])).toBe(5);
  expect(waitingCount({ ...lists, requests_waiting: 1 }, [{}, {}, {}])).toBe(4);
  expect(waitingCount({ ...lists, requests_waiting: 1 }, [{}])).toBe(2);
  expect(waitingCount({ added_you: [], requests_waiting: 0 }, [])).toBe(0);
});

test('older lists fall back to incoming requests; guests can have only seats', () => {
  expect(waitingCount({ added_you: [{}, {}] }, [{}])).toBe(3);
  expect(waitingCount({ added_you: [], requests_waiting: 0 }, [{}, {}])).toBe(2);
});

test('the server total wins when a refused join or stale cache disagrees', () => {
  expect(waitingCount({ added_you: [], requests_waiting: 0, waiting_for_you: 1 }, [])).toBe(1);
  expect(waitingCount({ added_you: [{}], requests_waiting: 1, waiting_for_you: 0 }, [{}])).toBe(0);
  expect(waitingCount({ added_you: [{}], requests_waiting: 1, waiting_for_you: 3 }, [{}, {}])).toBe(3);
});

test('the Friends tab: a waiting answer wins in red, else friends online in green, else nothing', () => {
  const friends = [
    { presence: 'online' },
    { presence: 'at_table' },
    { presence: 'offline' },
    { presence: 'offline' },
  ];
  expect(onlineCount(friends)).toBe(2);
  expect(onlineCount([{ presence: 'offline' }])).toBe(0);
  expect(friendsTabCount(1, 2)).toEqual({ tone: 'alert', count: 1 });
  expect(friendsTabCount(0, 2)).toEqual({ tone: 'online', count: 2 });
  expect(friendsTabCount(3, 0)).toEqual({ tone: 'alert', count: 3 });
  expect(friendsTabCount(0, 0)).toBeNull();
});
