import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { api } from '@/lib/api';

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Drives "chatting" presence for one circle feed screen: enters on mount,
 * heartbeats every 30s, and leaves on unmount or app backgrounding. Mounted
 * only in the thin feed-screen wrapper (app/[coopId]/posts.tsx), never
 * inside components/commons-ai-entry.tsx - the feed itself is unchanged.
 *
 * `circleId` is undefined for the synthetic general feed (no real Group row
 * to attach presence to), so this is a no-op until a real circle is open.
 */
export function useCirclePresence(circleId: string | undefined, sessionToken: string | null | undefined) {
  const activeRef = useRef(false);

  useEffect(() => {
    if (!circleId || !sessionToken) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const enter = () => {
      activeRef.current = true;
      void api.enterCircleChat(circleId, sessionToken);
      interval = setInterval(() => {
        void api.refreshCircleChatPresence(circleId, sessionToken);
      }, HEARTBEAT_INTERVAL_MS);
    };

    const leave = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      if (interval) clearInterval(interval);
      interval = null;
      void api.leaveCircleChat(circleId, sessionToken);
    };

    enter();

    // Best-effort cleanup on backgrounding - the 90s server-side expiry is
    // the real backstop for crashes/lost connections, per spec.
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        leave();
      } else if (state === 'active' && !activeRef.current) {
        enter();
      }
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      subscription.remove();
      leave();
    };
  }, [circleId, sessionToken]);
}
