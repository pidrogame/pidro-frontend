/**
 * What a push notification does. In the foreground it shows as a quiet banner; a tap
 * opens its `data.url`: an in-app path (`/play/abc`) through the router, anything else
 * with the system. The server decides where a notification leads.
 */
export const FOREGROUND_PRESENTATION = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: false,
  shouldSetBadge: false,
};

type PushResponse = { notification: { request: { content: { data?: unknown } } } };

export function handlePushResponse(
  response: PushResponse,
  open: { route: (path: string) => void; url: (url: string) => Promise<unknown> }
): void {
  const data = response.notification.request.content.data as { url?: unknown } | undefined;
  const url = data?.url;
  if (typeof url !== 'string' || !url) return;
  // `//host` is another site without a scheme, not a path in the app.
  if (url.startsWith('/') && !url.startsWith('//')) open.route(url);
  else void open.url(url).catch((error) => console.warn('[Push] Could not open', url, error));
}
