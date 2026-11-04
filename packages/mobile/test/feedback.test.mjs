import { describe, expect, it } from 'bun:test';
import {
  feedbackMailto,
  feedbackNote,
  nextAskCard,
  sendFailure,
} from '../src/features/feedback.ts';

const details = {
  appVersion: '1.0.0',
  nativeBuild: '7',
  updateId: '0193a2b4-7c1d-7e00-9f3a-5b6c7d8e9f01',
  channel: 'beta',
  platform: 'ios',
  osVersion: '18.1',
  deviceModel: 'iPhone 13 mini',
  player: { id: 'u-42', name: 'Åsa & Co?' },
};

const parse = (url) => {
  const [address, query] = url.split('?');
  const params = Object.fromEntries(
    query.split('&').map((pair) => {
      const [key, value] = pair.split('=');
      return [key, decodeURIComponent(value)];
    })
  );
  return { address, query, ...params };
};

describe('feedback mail', () => {
  it('goes to Marcel with the beta subject', () => {
    const mail = parse(feedbackMailto(details));
    expect(mail.address).toBe('mailto:marcel@pidro.online');
    expect(mail.subject).toBe('Pidro beta feedback');
  });

  it('leaves two empty lines to write in, then every detail', () => {
    expect(parse(feedbackMailto(details)).body).toBe(
      [
        '',
        '',
        'App version: 1.0.0',
        'Native build: 7',
        'Update: 0193a2b4-7c1d-7e00-9f3a-5b6c7d8e9f01 (channel beta)',
        'Platform: ios 18.1',
        'Device: iPhone 13 mini',
        'Player: Åsa & Co? (u-42)',
      ].join('\r\n')
    );
  });

  it('encodes so mail apps keep spaces, line breaks and a name with & or ?', () => {
    const { query } = parse(feedbackMailto(details));
    expect(query).toStartWith('subject=Pidro%20beta%20feedback&body=%0D%0A%0D%0AApp%20version');
    expect(query).not.toContain('+');
    expect(query.split('&')).toHaveLength(2);
    expect(query).toContain('%C3%85sa%20%26%20Co%3F');
  });

  it('says what it does not know instead of leaving blanks', () => {
    const { body } = parse(
      feedbackMailto({
        appVersion: null,
        nativeBuild: null,
        updateId: null,
        channel: null,
        platform: 'web',
        osVersion: null,
        deviceModel: null,
        player: null,
      })
    );
    expect(body.split('\r\n').slice(2)).toEqual([
      'App version: unknown',
      'Native build: unknown',
      'Update: none (channel unknown)',
      'Platform: web unknown',
      'Device: unknown',
      'Player: not signed in',
    ]);
  });
});

describe('feedback mail with the words', () => {
  it('starts with what the player wrote, then the details', () => {
    const body = parse(
      feedbackMailto(details, '  Bid buttons are small.\nOtherwise lovely. ')
    ).body;
    expect(body.split('\r\n').slice(0, 4)).toEqual([
      'Bid buttons are small.',
      'Otherwise lovely.',
      '',
      'App version: 1.0.0',
    ]);
  });
});

describe('a posted note', () => {
  it('trims the words, leaves out an empty address and unknown details', () => {
    const note = feedbackNote(' Too fast. ', '  ', { ...details, updateId: null, osVersion: null });
    expect(JSON.parse(JSON.stringify(note))).toEqual({
      kind: 'note',
      body: 'Too fast.',
      details: {
        app_version: '1.0.0',
        native_build: '7',
        channel: 'beta',
        platform: 'ios',
        device_model: 'iPhone 13 mini',
      },
    });
    expect(feedbackNote('Hi', ' a@b.c ', details).reply_email).toBe('a@b.c');
  });

  it('names the news post a Write back answers, as a number', () => {
    const sent = JSON.parse(JSON.stringify(feedbackNote('Love the sounds', '', details, 3)));
    expect(sent.news_post_id).toBe(3);
    expect(sent.kind).toBe('note');
    expect('news_post_id' in JSON.parse(JSON.stringify(feedbackNote('Hi', '', details)))).toBe(
      false
    );
  });

  it('waits for tomorrow only when the server says enough for today', () => {
    expect(sendFailure({ response: { status: 429, data: { code: 'RATE_LIMITED' } } })).toBe(
      'limit'
    );
    expect(sendFailure({ response: { status: 422, data: { code: 'VALIDATION_FAILED' } } })).toBe(
      'failed'
    );
    expect(sendFailure(new Error('Network Error'))).toBe('failed');
  });
});

describe('the question card on Home', () => {
  const asked = (ask, game_id = 'g-1') => ({ type: 'asked', answer: { ask, game_id } });
  const none = { type: 'asked', answer: { ask: null, game_id: null } };
  const pace = nextAskCard(null, asked('pace'));

  it('shows the question the server asks, nothing when it asks none', () => {
    expect(pace).toEqual({ ask: 'pace', gameId: 'g-1', picked: null, thanked: false });
    expect(nextAskCard(null, none)).toBeNull();
    expect(nextAskCard(null, asked('pace', null))).toBeNull();
  });

  it('marks the answer in place and takes no second one', () => {
    const marked = nextAskCard(pace, { type: 'picked', answer: 'too_slow' });
    expect(marked).toEqual({ ...pace, picked: 'too_slow' });
    expect(nextAskCard(marked, { type: 'picked', answer: 'right' })).toEqual(marked);
  });

  it('after an answer, a new question replaces the row', () => {
    const marked = nextAskCard(pace, { type: 'picked', answer: 'right' });
    expect(nextAskCard(marked, asked('old_pidro', 'g-1'))).toEqual({
      ask: 'old_pidro',
      gameId: 'g-1',
      picked: null,
      thanked: false,
    });
  });

  it('after an answer, no further question is the thanks, still showing the answer', () => {
    const marked = nextAskCard(pace, { type: 'picked', answer: 'too_fast' });
    expect(nextAskCard(marked, none)).toEqual({ ...marked, thanked: true });
  });

  it('the thanks and an unanswered question both go when the server asks nothing on the next focus', () => {
    const thanks = nextAskCard(nextAskCard(pace, { type: 'picked', answer: 'right' }), none);
    expect(nextAskCard(thanks, none)).toBeNull();
    expect(nextAskCard(pace, none)).toBeNull();
  });

  it('X hides it', () => {
    expect(nextAskCard(pace, { type: 'skipped' })).toBeNull();
  });
});
