import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { scrubPersonalData } from '@/features/crashScrub';

let Sentry: typeof import('@sentry/react-native') | null = null;

/**
 * Crash reporting. Inert until EXPO_PUBLIC_SENTRY_DSN is set; EAS's `production`
 * environment sets it for store builds and beta updates alike. The beta update uploads
 * its source maps under the same release and dist (scripts/publish-beta.mjs).
 *
 * EXPO_PUBLIC_SENTRY_TEST_ERROR, set only on a local web export, reports from web too and
 * throws a test error and a test rejection there. Platform.OS is inlined per bundle, so
 * iOS and Android bundles drop that code even when the variable is set.
 */
export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  const testError = process.env.EXPO_PUBLIC_SENTRY_TEST_ERROR;
  if (!dsn || (Platform.OS === 'web' && !testError)) return;

  const appVersion = Application.nativeApplicationVersion ?? undefined;
  const updateId = Updates.updateId?.toLowerCase();
  // An update runs on every build with its runtime, so its release leaves out the build
  // number and its dist is the update, as scripts/publish-beta.mjs uploads it. A build's
  // own bundle keeps the SDK's native release and dist; its maps go up with the build
  // once the Sentry config plugin is in (branch pid-493-native).
  const fromUpdate = !Updates.isEmbeddedLaunch && updateId && appVersion;
  const tags = {
    app_version: appVersion,
    runtime_version: Updates.runtimeVersion ?? undefined,
    update_id: updateId,
    channel: Updates.channel ?? undefined,
  };

  // Lazy require so the native SDK never executes on web or without a DSN.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
  Sentry.init({
    dsn,
    ...(fromUpdate
      ? { release: `${Application.applicationId}@${appVersion}`, dist: updateId }
      : {}),
    initialScope: { tags: Object.fromEntries(Object.entries(tags).filter(([, tag]) => tag)) },
    sendDefaultPii: false,
    beforeSend: (event) => scrubPersonalData(event),
    beforeSendTransaction: (event) => scrubPersonalData(event),
    beforeBreadcrumb: (breadcrumb) => scrubPersonalData(breadcrumb),
    // iOS records requests on its own, invite and push-token URLs included, and attaches
    // them to native crashes, which never pass through beforeSend. Not in the JS types.
    ...({ enableNetworkBreadcrumbs: false } as object),
    enableAutoSessionTracking: true,
    tracesSampleRate: 0.2,
  });

  // Not while Expo renders the static web pages in Node.
  if (testError && Platform.OS === 'web' && typeof window !== 'undefined') {
    console.warn('[Sentry] Test breadcrumb: ada@example.com opened /j/K7Q2ZP');
    setTimeout(() => {
      void Promise.reject(new Error(`Sentry test rejection ${testError}: ada@example.com`));
      throw new Error(`Sentry test error ${testError}: ada@example.com, ?token=s3cret`);
    }, 5000);
  }
}

/** A failure the app lives through: logged, and sent when crash reporting is on. */
export function reportFailure(context: string, error: unknown) {
  console.warn(`[${context}]`, error);
  Sentry?.captureException(error, { tags: { context } });
}
