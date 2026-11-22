import { expect, test } from 'bun:test';
import { scrubPersonalData } from '../src/features/crashScrub.ts';

test('an event keeps where it broke and loses who it happened to', () => {
  const event = {
    message: 'Join failed for ada.l@example.co.uk',
    user: { id: 'u_42', email: 'ada@example.com', username: 'ada', ip_address: '10.0.0.1' },
    tags: { context: 'Fonts', room: 'K7Q2', update_id: 'abc' },
    exception: {
      values: [
        {
          type: 'Error',
          value: 'Request to /api/v1/invites/INV9XZ/redeem?invite_code=INV9XZ&lang=sv failed',
          stacktrace: { frames: [{ filename: 'app:///main.jsbundle', lineno: 3, colno: 77 }] },
        },
      ],
    },
    request: { headers: { Authorization: 'Bearer eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl' } },
    extra: {
      body: { username: 'ada', password: 'hunter2', seat_password: '1234', position: 'north' },
      seat: { player_name: 'Ada L', slug: 'ada-l', at: new Date(0) },
    },
    sdkProcessingMetadata: { normalizeDepth: 3 },
  };

  const scrubbed = scrubPersonalData(event);

  expect(scrubbed.message).toBe('Join failed for [email]');
  expect(scrubbed.user).toEqual({
    id: 'u_42',
    email: '[redacted]',
    username: '[redacted]',
    ip_address: '[redacted]',
  });
  expect(scrubbed.tags).toEqual({ context: 'Fonts', room: 'K7Q2', update_id: 'abc' });
  expect(scrubbed.exception.values[0].value).toBe(
    'Request to /api/v1/invites/[redacted]/redeem?invite_code=[redacted]&lang=sv failed'
  );
  expect(scrubbed.exception.values[0].stacktrace.frames[0]).toEqual({
    filename: 'app:///main.jsbundle',
    lineno: 3,
    colno: 77,
  });
  expect(scrubbed.request.headers.Authorization).toBe('[redacted]');
  expect(scrubbed.extra.body).toEqual({
    username: '[redacted]',
    password: '[redacted]',
    seat_password: '[redacted]',
    position: 'north',
  });
  expect(scrubbed.extra.seat).toEqual({
    player_name: '[redacted]',
    slug: '[redacted]',
    at: new Date(0),
  });
  expect(scrubbed.sdkProcessingMetadata).toBe(event.sdkProcessingMetadata);
  // The event the SDK holds stays as it was.
  expect(event.user.email).toBe('ada@example.com');
});

test('console and navigation breadcrumbs lose emails, tokens and invite codes', () => {
  const error = new Error('Sign in failed for bob@pidro.online');
  const crumbs = [
    {
      category: 'console',
      message: '[Auth] token Bearer abc.def leaked',
      data: { arguments: ['[Auth] Sign in request failed:', error] },
    },
    { category: 'navigation', data: { from: '/lobby', to: 'https://pidro.online/j/K7Q2ZP?ref=x' } },
    {
      category: 'xhr',
      data: { url: 'https://app.pidro.online/api/v1/me/push-tokens/ExponentPushToken[xx]' },
    },
  ].map((crumb) => scrubPersonalData(crumb));

  expect(crumbs[0].message).toBe('[Auth] token Bearer [token] leaked');
  expect(crumbs[0].data.arguments[1]).toEqual({
    name: 'Error',
    message: 'Sign in failed for [email]',
  });
  expect(crumbs[1].data).toEqual({ from: '/lobby', to: 'https://pidro.online/j/[redacted]?ref=x' });
  expect(crumbs[2].data.url).toBe('https://app.pidro.online/api/v1/me/push-tokens/[redacted]');
});

test('a cycle (an axios error) ends at a marker and keeps the rest', () => {
  const request = { status: 500, url: '/api/v1/rooms/K7Q2' };
  request.self = request;
  const error = { config: { url: '/api/v1/invites/INV9XZ' }, request, response: request };
  expect(scrubPersonalData({ data: { arguments: [error] } }).data.arguments[0]).toEqual({
    config: { url: '/api/v1/invites/[redacted]' },
    request: { status: 500, url: '/api/v1/rooms/K7Q2', self: '[cycle]' },
    // The same object twice side by side is no cycle.
    response: { status: 500, url: '/api/v1/rooms/K7Q2', self: '[cycle]' },
  });
});

test('numbers, booleans and room codes pass untouched', () => {
  expect(scrubPersonalData({ score: 14, bid: true, code: 'K7Q2', level: 'error' })).toEqual({
    score: 14,
    bid: true,
    code: 'K7Q2',
    level: 'error',
  });
});
