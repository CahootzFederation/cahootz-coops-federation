import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';

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
  coopId = 'cahootz'
) {
  if (!sessionToken || Platform.OS === 'web') {
    if (__DEV__) console.info('[push] Registration skipped: no session or web platform');
    return { registered: false };
  }

  if (__DEV__) console.info('[push] Loading account preferences');
  const preferences = await api.getNotificationPreferences(sessionToken);
  if (!preferences.pushEnabled) {
    if (__DEV__) console.info('[push] Registration skipped: push disabled in preferences');
    return { registered: false };
  }

  if (__DEV__) console.info('[push] Checking device permission');
  const existingPermission = await Notifications.getPermissionsAsync();
  const existingPermissionState = existingPermission as unknown as {
    granted?: boolean;
    status?: string;
  };
  let granted = existingPermissionState.granted || existingPermissionState.status === 'granted' || existingPermission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

  if (!granted) {
    const requestedPermission = await Notifications.requestPermissionsAsync();
    const requestedPermissionState = requestedPermission as unknown as {
      granted?: boolean;
      status?: string;
    };
    granted = requestedPermissionState.granted || requestedPermissionState.status === 'granted';
  }

  if (!granted) {
    if (__DEV__) console.info('[push] Registration skipped: permission not granted');
    return { registered: false };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('commons', {
      name: 'Commons',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F97316',
    });
  }

  const projectId = getExpoProjectId();
  if (__DEV__) console.info('[push] Requesting Expo push token', { projectConfigured: !!projectId });
  const pushToken = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );

  if (__DEV__) console.info('[push] Token obtained; registering device with API');
  await api.registerPushDevice(
    {
      expoPushToken: pushToken.data,
      platform: Platform.OS,
      coopId,
      appVersion: Constants.expoConfig?.version || null,
    },
    sessionToken
  );

  if (__DEV__) console.info('[push] Device registered successfully');
  return { registered: true };
}

export async function getPushPermissionStatus(): Promise<string> {
  if (Platform.OS === 'web') return 'Push notifications are available in the mobile app. Your preferences still apply to your mobile devices.';
  const permission = await Notifications.getPermissionsAsync();
  if (permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'Notifications are allowed on this device.';
  return permission.canAskAgain ? 'Notifications are not enabled on this device yet.' : 'Notifications are blocked. Allow them in your device settings.';
}
