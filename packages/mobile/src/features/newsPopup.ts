import type { NewsPost } from '@pidro/shared';

/** Handled IDs live only for this cold start. Eligibility and durable receipts belong to the server. */
export function popupForStart({
  post,
  fallback = null,
  nativeUpdatePopup = false,
  handled,
  ready,
  atHome,
  inGame,
}: {
  post: NewsPost | null;
  fallback?: NewsPost | null;
  nativeUpdatePopup?: boolean;
  handled: ReadonlySet<number>;
  ready: boolean;
  atHome: boolean;
  inGame: boolean;
}) {
  const candidate = post ?? (nativeUpdatePopup ? null : fallback);
  return ready && atHome && !inGame && candidate && !handled.has(candidate.id) ? candidate : null;
}

/** Everything outside this small Markdown vocabulary stays literal text. */
export function parseNewsMarkdown(body: string) {
  const parts: { text: string; bold?: boolean; url?: string }[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g;
  let end = 0;
  for (const match of body.matchAll(pattern)) {
    if (match.index > end) parts.push({ text: body.slice(end, match.index) });
    parts.push(match[1] ? { text: match[1], bold: true } : { text: match[2], url: match[3] });
    end = match.index + match[0].length;
  }
  if (end < body.length) parts.push({ text: body.slice(end) });
  return parts;
}

/** The attached News boards, in the real Home popup. No fixture sends a receipt. */
export function newsPopupFixture(fixture: string | undefined, locale: string): NewsPost | null {
  if (
    !fixture ||
    !['popup-update', 'popup-image', 'popup-news', 'popup-ios', 'popup-link'].includes(fixture)
  )
    return null;
  const sv = locale === 'sv';
  const update = fixture !== 'popup-news' && fixture !== 'popup-link';
  return {
    id: 363,
    published_at: '2026-11-07T08:00:00Z',
    app_update: update,
    show_as_popup: true,
    eyebrow: update ? (sv ? 'Nytt i Pidro 3.2.4' : 'New in Pidro 3.2.4') : null,
    title: update
      ? sv
        ? 'Stabilare spel på svag uppkoppling'
        : 'Steadier games on a weak connection'
      : sv
        ? 'Ljuden från Classic är tillbaka'
        : 'The sounds from Classic are back',
    body: update
      ? sv
        ? 'Ditt kort kommer alltid fram, och **du får tillbaka din plats** om du tappar anslutningen. Dessutom: ljuden från Classic och veckoligor.'
        : 'Your card always lands, and **you get your seat back** if you drop out. Also: the sounds from Classic, and weekly leagues.'
      : sv
        ? 'Blandningen, given och din tur låter **precis som förr**.\nSpela en hand och lyssna.'
        : 'The shuffle, the deal and your turn sound **just like before**.\nPlay a hand and listen.',
    button_url: fixture === 'popup-link' ? 'https://example.invalid/news' : null,
    button_label: fixture === 'popup-link' ? (sv ? 'Läs mer' : 'Read more') : null,
  };
}
