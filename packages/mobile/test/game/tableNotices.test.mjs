import { describe, expect, it } from 'bun:test';
import {
  enqueueTableNotice,
  noticeHoldMs,
  refusalNotice,
  tableNoticeText,
} from '../../src/game/tableNotices.ts';
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

it('says whose turn it is by the name on their plate, and why your cards are folded (PID-485)', () => {
  const turn = (name) =>
    tableNoticeText({ key: 'game.turn_of', seat: { name }, turn: 'north', variant: 'warning' });
  const out = () => tableNoticeText({ key: 'game.out_notice', variant: 'warning' });
  try {
    setLocale('en');
    expect(turn('Marcel')).toBe("Marcel's turn");
    expect(turn(null)).toBe("A player's turn");
    expect(out()).toBe('You are out of trumps. New cards next hand.');
    setLocale('sv');
    expect(turn('Marcel')).toBe('Marcels tur');
    expect(out()).toBe('Du har slut på trumf. Nya kort nästa giv.');
  } finally {
    setLocale('en');
  }
  // One wait's notice is not the next one's, even when both seats go by the same name.
  const north = {
    key: 'game.turn_of',
    seat: { name: 'Player' },
    turn: 'north',
    variant: 'warning',
  };
  const east = { ...north, turn: 'east' };
  expect(enqueueTableNotice(enqueueTableNotice([], north, 'R'), east, 'R')).toHaveLength(2);
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

describe('how long a notice stays (PID-427)', () => {
  const lost = {
    key: 'game.notice_disconnected',
    seat: { name: 'Margaretha Lindqvist' },
    variant: 'warning',
  };
  const back = { key: 'game.notice_back', seat: { name: 'Nora' }, variant: 'success' };
  const autoCard = {
    variant: 'warning',
    autoTurn: { scope: 'you', action: { type: 'play_card', card: { rank: 5, suit: 'clubs' } } },
  };
  // Six cards played while you were away, and you are out: the longest table notice.
  const awayOut = {
    variant: 'warning',
    away: { cards: [10, 14, 5, 13, 12, 11].map((rank) => ({ rank, suit: 'spades' })), out: true },
  };
  const inLocale = (locale, check) => {
    try {
      setLocale(locale);
      check();
    } finally {
      setLocale('en');
    }
  };

  it('keeps a short notice up six seconds', () => {
    inLocale('en', () => {
      expect(tableNoticeText(refusalNotice({ reason: 'too_late' }))).toHaveLength(29);
      expect(noticeHoldMs([refusalNotice({ reason: 'too_late' })])).toBe(6000);
    });
    inLocale('sv', () => expect(noticeHoldMs([refusalNotice({ reason: 'too_late' })])).toBe(6000));
  });

  it('keeps a long one up 2 s plus 90 ms a letter', () => {
    inLocale('en', () => {
      // "Margaretha Lindqvist lost connection. A bot is playing for now."
      expect(tableNoticeText(lost)).toHaveLength(63);
      expect(noticeHoldMs([lost])).toBe(2000 + 63 * 90);
    });
    inLocale('sv', () => {
      // "Margaretha Lindqvist tappade anslutningen. En bot spelar tills vidare."
      expect(tableNoticeText(lost)).toHaveLength(70);
      expect(noticeHoldMs([lost])).toBe(2000 + 70 * 90);
    });
  });

  it('gives a notice its full time when others wait behind it', () => {
    for (const locale of ['en', 'sv'])
      inLocale(locale, () => {
        const queue = [back, lost, autoCard].reduce(
          (current, notice) => enqueueTableNotice(current, notice, 'ROOM'),
          []
        );
        expect(queue).toHaveLength(3);
        expect(noticeHoldMs(queue)).toBe(6000);
        expect(noticeHoldMs(queue.slice(1))).toBe(noticeHoldMs([lost]));
      });
  });

  it('keeps what was done for you up at least eight seconds', () => {
    inLocale('en', () => {
      expect(tableNoticeText(autoCard)).toBe('Time ran out — we played 5♣ for you');
      expect(noticeHoldMs([autoCard])).toBe(8000);
      const lateCard = { variant: 'warning', error: { error_code: 'already_played_for_you' } };
      expect(noticeHoldMs([lateCard])).toBe(8000);
      // Played for someone else: an ordinary notice, its reading time.
      const forRoom = { ...autoCard, autoTurn: { ...autoCard.autoTurn, scope: 'room' } };
      expect(tableNoticeText(forRoom)).toBe('Time ran out, so 5♣ was played automatically.');
      expect(noticeHoldMs([forRoom])).toBe(2000 + 45 * 90);
      expect(tableNoticeText(awayOut)).toHaveLength(90);
      expect(noticeHoldMs([awayOut, back])).toBe(2000 + 90 * 90);
    });
    inLocale('sv', () => {
      expect(noticeHoldMs([autoCard])).toBe(8000);
      expect(tableNoticeText(awayOut)).toBe(
        'Medan du var borta spelades 10♠, A♠, 5♠, K♠, Q♠ och J♠ åt dig, du är ute den här given.'
      );
      expect(noticeHoldMs([awayOut, back])).toBe(2000 + 87 * 90);
    });
  });
});
