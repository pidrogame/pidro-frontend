import { describe, expect, it } from 'bun:test';
import { feedbackMailto } from '../src/features/feedback.ts';

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
