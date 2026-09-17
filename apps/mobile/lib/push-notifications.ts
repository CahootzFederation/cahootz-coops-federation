import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';

export class PushRegistrationError extends Error {
  constructor(public readonly step: string, message: string) {
    super(message);
    this.name = 'PushRegistrationError';
  }
}

function redactPushError(value: string, secrets: string[]) {
  let safe = value;
  for (const secret of secrets) {
    if (secret) safe = safe.split(secret).join('[redacted]');
  }
  return safe
    .replace(/(?:ExponentPushToken|ExpoPushToken)\[[^\]]*\]/g, '[redacted push token]')
    .replace(/\b[a-f0-9]{64,}\b/gi, '[redacted device token]')
    .slice(0, 1000);
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function getExpoProjectId() {
  const constants = Constants as any;
  return (
    Constants.easConfig?.projectId ||
    Constants.expoConfig?.extra?.eas?.projectId ||
    constants.manifest2?.extra?.expoClient?.extra?.eas?.projectId
  );
}

export async function registerForNativePushNotifications(
  sessionToken: string | null | undefined,
  coopId = 'cahootz',
  options: { onlyAskIfUndetermined?: boolean } = {}
) {
  const secrets = [sessionToken || ''];
  const step = async <T,>(name: string, action: () => Promise<T>): Promise<T> => {
    console.info('[push] Registration step started', { step: name });
    try {
      const value = await action();
      console.info('[push] Registration step completed', { step: name });
      return value;
    } catch (error) {
      const message = redactPushError(error instanceof Error ? error.message : String(error), secrets);
      const code = error && typeof error === 'object' && 'code' in error
        ? redactPushError(String(error.code), secrets) : undefined;
      console.warn('[push] Registration failed', { step: name, code, message, platform: Platform.OS });
      // Callers must not re-log the original error, which could contain tokens.
      throw new PushRegistrationError(name, message);
    }
  };
  if (!sessionToken || Platform.OS === 'web') {
    console.info('[push] Registration skipped: no session or web platform');
    return { registered: false };
  }

  const preferences = await step('Load account preferences', () => api.getNotificationPreferences(sessionToken));
  if (!preferences.pushEnabled) {
    console.info('[push] Registration skipped: push disabled in preferences');
    return { registered: false };
  }

  const existingPermission = await step('Check notification permission', () => Notifications.getPermissionsAsync());
  console.info('[push] Device permission', { status: existingPermission.status, canAskAgain: existingPermission.canAskAgain, iosStatus: existingPermission.ios?.status });
  const existingPermissionState = existingPermission as unknown as {
    granted?: boolean;
    status?: string;
  };
  let granted = existingPermissionState.granted || existingPermissionState.status === 'granted' || existingPermission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

  const mayAsk = existingPermission.canAskAgain !== false &&
    (!options.onlyAskIfUndetermined || existingPermission.status === 'undetermined');
  if (!granted && mayAsk) {
    const requestedPermission = await step('Request notification permission', () => Notifications.requestPermissionsAsync());
    const requestedPermissionState = requestedPermission as unknown as {
      granted?: boolean;
      status?: string;
    };
    granted = requestedPermissionState.granted || requestedPermissionState.status === 'granted' || requestedPermission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  }

  if (!granted) {
    console.info('[push] Registration skipped: permission not granted');
    return { registered: false };
  }

  if (Platform.OS === 'android') {
    await step('Configure Android channel', () => Notifications.setNotificationChannelAsync('commons', {
      name: 'Commons',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F97316',
    }));
  }

  const projectId = getExpoProjectId();
  console.info('[push] Build configuration', { projectId: projectId || '(missing)', appVersion: Constants.expoConfig?.version, platform: Platform.OS });
  const pushToken = await step('Get Expo push token', () => Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  ));
  secrets.push(pushToken.data);

  await step('Save device with API', () => api.registerPushDevice(
    {
      expoPushToken: pushToken.data,
      platform: Platform.OS,
      coopId,
      appVersion: Constants.expoConfig?.version || null,
    },
    sessionToken
  ));

  console.info('[push] Device registered successfully');
  return { registered: true };
}

export async function getPushPermissionStatus(): Promise<string> {
  if (Platform.OS === 'web') return 'Push notifications are available in the mobile app. Your preferences still apply to your mobile devices.';
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'Notifications are allowed on this device.';
  return permission.canAskAgain ? 'Notifications are not enabled on this device yet.' : 'Notifications are blocked. Allow them in your device settings.';
}
