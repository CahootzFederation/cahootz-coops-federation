import { secureStorage } from './secure-storage';
import {
  getPushPermissionState,
  registerForNativePushNotifications,
  type PushPermissionState,
} from './push-notifications';

// Per-device, and deliberately not one of secureStorage.keys: those are
// wiped on logout, but "Not now" is about this device, not the account.
const PUSH_PRIMER_DISMISSED_AT_KEY = 'cahootz.pushPrimerDismissedAt';

/** After "Not now", don't offer the push primer again on this device for this long. */
export const PUSH_PRIMER_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Whether to offer the in-app "want a heads-up?" primer. Never when the OS
 * already granted or blocked notifications (a blocked prompt can't be shown
 * again), nor within PUSH_PRIMER_SNOOZE_MS of a dismissal. Mobile web can't
 * register for pushes, but still gets the primer so the choice is the same
 * everywhere; there, "Yes" only confirms that replies land in Alerts.
 */
export function shouldOfferPushPrimer(
  permission: PushPermissionState,
  dismissedAt: number | null,
  now: number,
) {
  if (permission === 'granted' || permission === 'blocked') return false;
  if (dismissedAt !== null && now - dismissedAt < PUSH_PRIMER_SNOOZE_MS) return false;
  return true;
}

async function readDismissedAt() {
  const value = await secureStorage.getItem(PUSH_PRIMER_DISMISSED_AT_KEY);
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export async function canOfferPushPrimer(now = Date.now()) {
  try {
    const [permission, dismissedAt] = await Promise.all([getPushPermissionState(), readDismissedAt()]);
    return shouldOfferPushPrimer(permission, dismissedAt, now);
  } catch (error) {
    console.warn('Could not check push primer eligibility', error);
    return false;
  }
}

export async function dismissPushPrimer(now = Date.now()) {
  try {
    await secureStorage.setItem(PUSH_PRIMER_DISMISSED_AT_KEY, String(now));
  } catch (error) {
    console.warn('Could not remember push primer dismissal', error);
  }
}

/**
 * The primer's "Yes": the only place the OS permission prompt is shown.
 * Resolves to whether this device is now registered for pushes.
 */
export async function acceptPushPrimer(sessionToken: string, coopId: string) {
  // Stamp first so a crash mid-prompt doesn't bring the primer straight back.
  await dismissPushPrimer();
  try {
    const result = await registerForNativePushNotifications(sessionToken, coopId, {
      source: 'welcome_intro_primer',
    });
    return result.registered;
  } catch (error) {
    console.warn('Push registration from primer skipped', error);
    return false;
  }
}
