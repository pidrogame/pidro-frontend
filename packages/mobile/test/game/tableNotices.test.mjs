import { describe, expect, it } from 'bun:test';
import { enqueueTableNotice, refusalNotice, tableNoticeText } from '../../src/game/tableNotices.ts';
import { setLocale, t } from '@pidro/shared';

const notice = (message, variant = 'warning') => ({ message, variant });

it('says which card, pass or bid the timer made, in both table languages', () => {
  try {
    for (const locale of ['en', 'sv']) {
      setLocale(locale);
      const text = (action) =>
        tableNoticeText({ variant: 'warning', autoTurn: { scope: 'you', action } });
      expect(text({ type: 'play_card', card: { rank: 5, suit: 'clubs' } })).toBe(
        locale === 'en'
          ? 'Time ran out — we played 5♣ for you'
          : 'Tiden tog slut – vi spelade 5♣ åt dig'
      );
      expect(
        tableNoticeText({
          variant: 'warning',
          error: {
            error_code: 'already_played_for_you',
            action: { type: 'play_card', card: { rank: 5, suit: 'clubs' } },
          },
        })
      ).toBe(
        locale === 'en'
          ? 'Time ran out — we played 5♣ for you'
          : 'Tiden tog slut – vi spelade 5♣ åt dig'
      );
      expect(text({ type: 'pass' })).toBe(
        locale === 'en' ? 'Time ran out — we passed for you' : 'Tiden tog slut – vi passade åt dig'
      );
      expect(text({ type: 'bid', amount: 7 })).toBe(
        locale === 'en' ? 'Time ran out — we bid 7 for you' : 'Tiden tog slut – vi bjöd 7 åt dig'
      );
      expect(t('ui.reconnecting')).toBe(locale === 'en' ? 'Reconnecting…' : 'Återansluter…');
      expect(tableNoticeText({ variant: 'error', error: { reason: 'not_your_turn' } })).toBe(
        locale === 'en' ? 'It is not your turn.' : 'Det är inte din tur.'
      );
    }
  } finally {
    setLocale('en');
  }
});

it('says a tap was late, and what was played for you while you were away (PID-364)', () => {
  const spade = (rank) => ({ rank, suit: 'spades' });
  const away = (cards, out = false) =>
    tableNoticeText({ variant: 'warning', away: { cards, out } });
  try {
    setLocale('en');
    expect(tableNoticeText(refusalNotice({ reason: 'too_late' }))).toBe(
      'Too late, the trick moved on.'
    );
    expect(refusalNotice({ reason: 'too_late' }).variant).toBe('warning');
    expect(away([spade(10)])).toBe('While you were away, 10♠ was played for you.');
    expect(away([spade(10), { rank: 5, suit: 'hearts' }])).toBe(
      'While you were away, 10♠ and 5♥ were played for you.'
    );
    expect(away([spade(10), spade(14), { rank: 5, suit: 'hearts' }])).toBe(
      'While you were away, 10♠, A♠ and 5♥ were played for you.'
    );
    expect(away([spade(10)], true)).toBe(
      "While you were away, 10♠ was played for you, you're out this hand."
    );
    expect(away([spade(10), { rank: 5, suit: 'hearts' }], true)).toBe(
      "While you were away, 10♠ and 5♥ were played for you, you're out this hand."
    );
    setLocale('sv');
    expect(tableNoticeText(refusalNotice({ reason: 'too_late' }))).toBe(
      'För sent – sticket gick vidare.'
    );
    expect(away([spade(10), { rank: 5, suit: 'hearts' }], true)).toBe(
      'Medan du var borta spelades 10♠ och 5♥ åt dig, du är ute den här given.'
    );
  } finally {
    setLocale('en');
  }
  // A server refusal keeps its own words.
  expect(tableNoticeText(refusalNotice({ error_code: 'must_follow_suit' }))).toBe(
    tableNoticeText({ variant: 'error', error: { error_code: 'must_follow_suit' } })
  );
});

describe('table notice queue', () => {
  it('coalesces only consecutive exact repeats', () => {
    const first = enqueueTableNotice([], notice('Disconnected'), 'ROOM');
    const duplicate = enqueueTableNotice(first, notice('Disconnected'), 'ROOM');
    const reconnected = enqueueTableNotice(duplicate, notice('Reconnected', 'success'), 'ROOM');
    const disconnectedAgain = enqueueTableNotice(reconnected, notice('Disconnected'), 'ROOM');

    expect(duplicate).toEqual(first);
    expect(disconnectedAgain.map(({ message }) => message)).toEqual([
      'Disconnected',
      'Reconnected',
      'Disconnected',
    ]);
  });

  it('keeps the current notice and the two newest pending notices', () => {
    const queued = ['A', 'B', 'C', 'D'].reduce(
      (current, message) => enqueueTableNotice(current, notice(message), 'ROOM'),
      []
    );

    expect(queued.map(({ message }) => message)).toEqual(['A', 'C', 'D']);
  });

  it('does not carry notices between rooms', () => {
    const oldRoom = enqueueTableNotice([], notice('Old room'), 'OLD');
    const newRoom = enqueueTableNotice(oldRoom, notice('New room', 'success'), 'NEW');

    expect(newRoom).toEqual([{ message: 'New room', variant: 'success', roomCode: 'NEW' }]);
  });
});
