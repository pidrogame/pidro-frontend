import { useEffect, useRef, type ReactNode } from 'react';
import { useSegments } from 'expo-router';
import * as Updates from 'expo-updates';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { useAuthStore } from '@/stores/auth';

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;

type AnalyticsProperties = Record<string, boolean | number | string | null>;
type CaptureAnalytics = (event: string, properties?: AnalyticsProperties) => void;

const noCapture: CaptureAnalytics = () => {};
let captureWithPostHog = noCapture;

export function captureAnalytics(event: string, properties?: AnalyticsProperties) {
  captureWithPostHog(event, properties);
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  if (!apiKey) return <>{children}</>;

  return (
    <PostHogProvider
      apiKey={apiKey}
      options={{
        host: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com',
        enableSessionReplay: false,
      }}
      autocapture={{ captureScreens: false, captureTouches: false }}>
      {children}
    </PostHogProvider>
  );
}

function EnabledAnalyticsTracker() {
  const posthog = usePostHog();
  const segments = useSegments();
  const user = useAuthStore((state) => state.user);
  const previousScreen = useRef<string | null>(null);
  const screen = `/${segments.join('/')}`;

  useEffect(() => {
    const capture: CaptureAnalytics = (event, properties) => posthog.capture(event, properties);
    captureWithPostHog = capture;

    return () => {
      if (captureWithPostHog === capture) captureWithPostHog = noCapture;
    };
  }, [posthog]);

  useEffect(() => {
    if (user) {
      posthog.identify(user.id, {
        username: user.username,
        account_type: user.guest ? 'guest' : 'registered',
      });
    } else {
      posthog.reset();
    }
    posthog.register({
      app_platform: 'mobile',
      // The beta and the store app share EAS's production environment, so the
      // install's update channel is what tells a beta tester apart.
      app_environment:
        Updates.channel ||
        process.env.EXPO_PUBLIC_APP_ENVIRONMENT ||
        (__DEV__ ? 'development' : 'production'),
    });
  }, [posthog, user]);

  useEffect(() => {
    if (screen !== previousScreen.current) {
      posthog.screen(screen);
      previousScreen.current = screen;
    }
  }, [posthog, screen]);

  return null;
}

export function AnalyticsTracker() {
  return apiKey ? <EnabledAnalyticsTracker /> : null;
}
