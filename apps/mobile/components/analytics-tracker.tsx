import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useSegments } from 'expo-router';

import { useAuth } from '@/contexts/auth-context';
import {
  consumeFirstOpen,
  daysSince,
  identify,
  initAnalytics,
  isAnalyticsEnabled,
  routeNameFromSegments,
  screen,
  track,
} from '@/lib/analytics';

initAnalytics();

/**
 * Sends app_opened (on launch and on return from background), keeps the
 * PostHog identity in sync with the signed-in account, and records screen
 * views by route pattern. Renders nothing; does nothing when analytics is off.
 */
export function AnalyticsTracker() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const coldStartSent = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;

  // Session restore: identify before app_opened so it's attributed to the account.
  useEffect(() => {
    if (isLoading || !user) return;
    identify(user.id, { coopId: user.coop?.id ?? 'cahootz' });
  }, [isLoading, user?.id, user?.coop?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAnalyticsEnabled() || isLoading || coldStartSent.current) return;
    coldStartSent.current = true;
    void consumeFirstOpen().then((isFirstOpen) => {
      const current = userRef.current;
      track('app_opened', {
        source: 'cold_start',
        is_first_open: isFirstOpen,
        signed_in: !!current,
        days_since_signup: daysSince(current?.createdAt),
      });
    });
  }, [isLoading]);

  useEffect(() => {
    if (!isAnalyticsEnabled()) return;
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (previous.match(/inactive|background/) && next === 'active') {
        const current = userRef.current;
        track('app_opened', {
          source: 'foreground',
          is_first_open: false,
          signed_in: !!current,
          days_since_signup: daysSince(current?.createdAt),
        });
      }
      previous = next;
    });
    return () => subscription.remove();
  }, []);

  const routeName = routeNameFromSegments(segments);
  useEffect(() => {
    if (isAnalyticsEnabled()) screen(routeName);
  }, [routeName]);

  return null;
}
