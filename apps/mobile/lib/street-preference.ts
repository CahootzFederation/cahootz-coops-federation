import { secureStorage } from '@/lib/secure-storage';

// Whether the Commons tab opens on the walkable street instead of the circles
// screen. Off by default. It's a per-device display choice, kept out of
// secureStorage.keys on purpose so signing out doesn't reset it.
export const STREET_VIEW_KEY = 'cahootz.streetView';

export async function getStreetViewEnabled(): Promise<boolean> {
  return (await secureStorage.getItem(STREET_VIEW_KEY)) === 'on';
}

export async function setStreetViewEnabled(enabled: boolean): Promise<void> {
  if (enabled) await secureStorage.setItem(STREET_VIEW_KEY, 'on');
  else await secureStorage.removeItem(STREET_VIEW_KEY);
}
