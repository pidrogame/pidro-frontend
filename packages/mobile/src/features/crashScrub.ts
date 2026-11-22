/**
 * What a crash report may not carry: emails, names, passwords (seat passwords too), tokens
 * and invite codes. Every event and breadcrumb passes through here before it leaves the
 * phone (src/bootstrap/sentry.ts). Room codes and error codes stay: they say where it broke.
 */
const PERSONAL_KEY =
  /password|passwd|secret|token|authorization|cookie|e-?mail|username|display_?name|player_?name|full_?name|slug|first_?name|last_?name|invite|ip_address/i;

const PERSONAL_TEXT: [RegExp, string][] = [
  [/[\w.+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/gi, '[email]'],
  [/\bBearer\s+[^\s"',]+/gi, 'Bearer [token]'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[token]'],
  // Invite links (/j/, /join/), the invites API and push tokens carry the secret in the path.
  [/\/(invites|j|join|push-tokens)\/[^/?#\s"']+/gi, '/$1/[redacted]'],
  [
    /([?&#][^=&#\s"']*(?:token|code|password|email|invite)[^=&#\s"']*)=[^&#\s"']*/gi,
    '$1=[redacted]',
  ],
];

/** `ancestors` is the path down to `value`: its length is the depth, a repeat is a cycle. */
export function scrubPersonalData<T>(value: T, ancestors: object[] = []): T {
  if (typeof value === 'string')
    return PERSONAL_TEXT.reduce<string>(
      (text, [pattern, mask]) => text.replace(pattern, mask),
      value
    ) as T;
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  // Console breadcrumbs carry whatever was logged, cycles included (an axios error). An
  // event's stack frames sit six levels down.
  if (ancestors.includes(value)) return '[cycle]' as T;
  if (ancestors.length > 8) return '[…]' as T;
  const path = [...ancestors, value];
  if (Array.isArray(value)) return value.map((item) => scrubPersonalData(item, path)) as T;
  const entries = Object.entries(value).map(([key, item]) => [
    key,
    // The SDK's own bookkeeping (scopes, spans), dropped before the event is sent.
    key === 'sdkProcessingMetadata'
      ? item
      : PERSONAL_KEY.test(key) && item != null
        ? '[redacted]'
        : scrubPersonalData(item, path),
  ]);
  if (value instanceof Error)
    entries.push(['name', value.name], ['message', scrubPersonalData(value.message)]);
  return Object.fromEntries(entries) as T;
}
