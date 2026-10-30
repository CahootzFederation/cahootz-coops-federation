import { AppState } from 'react-native';

import { getApiUrl } from './config';

/**
 * Whether the app can reach the Cahootz API right now.
 *
 * There's no native network listener (that would need a new App Store build),
 * so the fetch wrapper in lib/api.ts reports what it sees: any answer from the
 * API means online, a request that can't connect or times out means offline.
 * While offline, a cheap /health check runs every PROBE_INTERVAL_MS and when
 * the app comes back to the foreground, so the app notices the connection
 * returning even if no screen is loading anything.
 */

export type Connectivity = {
  online: boolean;
  /** A screen is showing data saved on the phone instead of live data. */
  showingSaved: boolean;
};

export const PROBE_INTERVAL_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;

let state: Connectivity = { online: true, showingSaved: false };
const listeners = new Set<() => void>();
const reconnectListeners = new Set<() => void>();
let probeTimer: ReturnType<typeof setInterval> | null = null;
let probing = false;
let appStateSubscription: { remove: () => void } | null = null;

function setState(next: Connectivity) {
  if (next.online === state.online && next.showingSaved === state.showingSaved) return;
  const reconnected = !state.online && next.online;
  state = next;
  listeners.forEach((listener) => listener());
  if (reconnected) reconnectListeners.forEach((listener) => listener());
}

export function getConnectivity() {
  return state;
}

export function subscribeConnectivity(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Runs `listener` each time the app goes from offline back to online. */
export function onReconnect(listener: () => void) {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}

/** The API answered (any status). */
export function reportReachable() {
  stopProbing();
  setState({ online: true, showingSaved: false });
}

/** A request couldn't reach the API. `servedSaved` when saved data was shown instead. */
export function reportUnreachable(servedSaved: boolean) {
  setState({ online: false, showingSaved: state.showingSaved || servedSaved });
  startProbing();
}

/** Checks the API once now. Resolves true when it answered. */
export async function checkConnection(fetcher: typeof fetch = globalThis.__soulaanOriginalFetch ?? fetch) {
  if (probing) return state.online;
  probing = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetcher(`${getApiUrl()}/health`, { signal: controller.signal });
    reportReachable();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    probing = false;
  }
}

function startProbing() {
  if (probeTimer) return;
  probeTimer = setInterval(() => {
    void checkConnection();
  }, PROBE_INTERVAL_MS);
  appStateSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') void checkConnection();
  });
}

function stopProbing() {
  if (probeTimer) clearInterval(probeTimer);
  probeTimer = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
}

/** Test helper: back to the online starting state. */
export function resetConnectivityForTests() {
  stopProbing();
  probing = false;
  state = { online: true, showingSaved: false };
}
