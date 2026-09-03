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
  if (!sessionToken || Platform.OS === 'web') return { registered: false };

  const existingPermission = await Notifications.getPermissionsAsync();
  const existingPermissionState = existingPermission as unknown as {
    granted?: boolean;
    status?: string;
  };
  let granted = existingPermissionState.granted || existingPermissionState.status === 'granted';

  if (!granted) {
    const requestedPermission = await Notifications.requestPermissionsAsync();
    const requestedPermissionState = requestedPermission as unknown as {
      granted?: boolean;
      status?: string;
    };
    granted = requestedPermissionState.granted || requestedPermissionState.status === 'granted';
  }

  if (!granted) {
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
  const pushToken = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );

  await api.registerPushDevice(
    {
      expoPushToken: pushToken.data,
      platform: Platform.OS,
      coopId,
      appVersion: Constants.expoConfig?.version || null,
    },
    sessionToken
  );

  return { registered: true };
}
