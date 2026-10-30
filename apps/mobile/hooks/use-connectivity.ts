import { useEffect, useRef, useSyncExternalStore } from 'react';

import { getConnectivity, onReconnect, subscribeConnectivity } from '@/lib/connectivity';

/** Whether the API is reachable, and whether saved data is on screen. */
export function useConnectivity() {
  return useSyncExternalStore(subscribeConnectivity, getConnectivity, getConnectivity);
}

/**
 * Reloads a screen's data when the connection comes back, so a screen that
 * showed saved data (or a "couldn't reach Cahootz" message) catches up on
 * its own.
 */
export function useRefreshOnReconnect(refresh: () => unknown) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => onReconnect(() => void latest.current()), []);
}
