import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useAuth } from "@/contexts/auth-context";
import { useQueryClient } from "@tanstack/react-query";

/** Refresh the inbox on delivery and open it when a native notification is tapped. */
export function NotificationResponseHandler() {
  const { sessionToken } = useAuth();
  const client = useQueryClient();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS === "web" || !sessionToken) return;
    let active = true;
    const refresh = () => {
      void client.invalidateQueries({
        queryKey: ["notifications", sessionToken],
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
      refresh();
      router.push("/(tabs)/notifications");
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
  }, [sessionToken, client]);
  return null;
}
