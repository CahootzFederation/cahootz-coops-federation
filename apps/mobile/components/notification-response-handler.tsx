import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useAuth } from "@/contexts/auth-context";
import { useNavigationReady } from "@/hooks/use-navigation-ready";
import { useQueryClient } from "@tanstack/react-query";
import { track } from "@/lib/analytics";
import { alertFromPush } from "@/lib/in-app-alerts";
import { notificationDestination } from "@/lib/notification-navigation";

/** Refresh the inbox on delivery; a tapped notification opens what it is about. */
export function NotificationResponseHandler() {
  const { sessionToken } = useAuth();
  const client = useQueryClient();
  const handled = useRef<string | null>(null);
  // A tap that launched the app is read right away; wait until it can navigate.
  const navigationReady = useNavigationReady();
  useEffect(() => {
    if (Platform.OS === "web" || !sessionToken || !navigationReady) return;
    let active = true;
    const refresh = () => {
      void client.invalidateQueries({
        queryKey: ["notifications", sessionToken],
      });
      void client.invalidateQueries({
        queryKey: ["unread-notifications-badge", sessionToken],
      });
    };
    const open = (response: Notifications.NotificationResponse | null) => {
      if (
        !active ||
        !response ||
        handled.current === response.notification.request.identifier
      )
        return;
      handled.current = response.notification.request.identifier;
      const notificationType = response.notification.request.content.data?.notificationType;
      track("notification_opened", {
        channel: "push",
        notification_type: typeof notificationType === "string" ? notificationType : "unknown",
      });
      refresh();
      const alert = alertFromPush(response.notification.request.content);
      router.push((alert && notificationDestination(alert)) || "/(tabs)/notifications");
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    const delivery = Notifications.addNotificationReceivedListener(refresh);
    const response =
      Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync()
      .then(open)
      .catch(() => {});
    return () => {
      active = false;
      delivery.remove();
      response.remove();
    };
  }, [sessionToken, navigationReady, client]);
  return null;
}
