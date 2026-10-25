import { useEffect, useState } from 'react';
import { useNavigationContainerRef } from 'expo-router';

/**
 * True once the root navigator can take navigation calls.
 *
 * `router.push`/`replace` only queue an action; expo-router replays the queue
 * in an effect that throws "Attempted to navigate before mounting the Root
 * Layout component" if the navigator isn't ready yet. React Native treats
 * that uncaught effect error as fatal, and expo-updates can't recover from a
 * fatal at launch without a network connection, so the app quits.
 *
 * Online, startup code that navigates usually waits on a server call first,
 * which hides the race. Offline that call fails instantly, so any effect that
 * navigates during startup must wait for this to be true.
 */
export function useNavigationReady() {
  const navigationRef = useNavigationContainerRef();
  const [ready, setReady] = useState(() => navigationRef.isReady());

  useEffect(() => {
    if (ready) return;
    if (navigationRef.isReady()) {
      setReady(true);
      return;
    }
    return navigationRef.addListener('ready', () => setReady(true));
  }, [navigationRef, ready]);

  return ready;
}
