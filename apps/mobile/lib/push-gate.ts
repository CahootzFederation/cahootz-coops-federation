import { Platform } from 'react-native';

import { api } from './api';
import {
  getPushPermissionState,
  registerForNativePushNotifications,
  type PushPermissionState,
} from './push-notifications';

/**
 * What the app-open push card should do.
 * - `none`: nothing to show (allowed, push switched off in our settings, or web).
 * - `ask`: the phone was never asked; our button shows the system popup.
 * - `settings`: the phone said no. iOS never shows its popup twice, so our
 *   button opens this app's page in Settings instead.
 */
export type PushGateStep = 'none' | 'ask' | 'settings';

export function pushGateStep(permission: PushPermissionState, pushEnabled: boolean): PushGateStep {
  // Turning push off in Notification settings is the member's choice; don't nag.
  if (!pushEnabled || permission === 'unsupported' || permission === 'granted') return 'none';
  return permission === 'blocked' ? 'settings' : 'ask';
}

/**
 * Runs every time the app opens. A phone that allows notifications is
 * (re)registered quietly, so a refreshed push token is never lost; otherwise
 * the result says which card to show.
 */
export async function checkPushOnOpen(sessionToken: string): Promise<PushGateStep> {
  if (Platform.OS === 'web') return 'none';
  const [permission, preferences] = await Promise.all([
    getPushPermissionState(),
    api.getNotificationPreferences(sessionToken),
  ]);
  if (permission === 'granted' && preferences.pushEnabled) {
    try {
      await registerForNativePushNotifications(sessionToken, { neverAsk: true });
    } catch (error) {
      console.warn('Push registration on app open skipped', error);
    }
  }
  return pushGateStep(permission, preferences.pushEnabled);
}

/** The card's main button on a never-asked phone. Resolves to whether pushes now work. */
export async function askForPushFromGate(sessionToken: string) {
  try {
    const result = await registerForNativePushNotifications(sessionToken, { source: 'app_open' });
    return result.registered;
  } catch (error) {
    console.warn('Push registration from app-open card failed', error);
    return false;
  }
}
