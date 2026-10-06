import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { router, usePathname } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Bell, MessageCircle, Sparkles, UserPlus, X } from "lucide-react-native";

import type { AccountNotification } from "@repo/validators/notification";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/lib/api";
import { track } from "@/lib/analytics";
import { notificationDestination } from "@/lib/notification-navigation";
import {
  IN_APP_ALERT_POLL_MS,
  IN_APP_ALERT_VISIBLE_MS,
  alertFromPush,
  enqueueAlerts,
  inAppAlertKind,
  shouldShowInAppAlert,
  takeNewAlerts,
  type InAppAlertKind,
} from "@/lib/in-app-alerts";

const KIND_STYLE: Record<InAppAlertKind, { icon: typeof Bell; color: string; background: string }> = {
  sage: { icon: Sparkles, color: "#C2410C", background: "#FFEDD5" },
  joined: { icon: UserPlus, color: "#047857", background: "#D1FAE5" },
  mention: { icon: AtSign, color: "#1D4ED8", background: "#DBEAFE" },
  message: { icon: MessageCircle, color: "#7C3AED", background: "#EDE9FE" },
  other: { icon: Bell, color: "#475569", background: "#F1F5F9" },
};

/**
 * Pops up new alerts (mentions, circle posts, people joining, Sage
 * suggestions) while the app is open. Pushes that arrive in the foreground
 * show here instead of as a system banner; a short poll catches alerts for
 * people without push (or on web). Tapping opens what the alert is about.
 */
export function InAppAlertPopup() {
  const { sessionToken, isAuthenticated } = useAuth();
  const client = useQueryClient();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [queue, setQueue] = useState<AccountNotification[]>([]);
  const [appActive, setAppActive] = useState(AppState.currentState !== "background");
  const seen = useRef(new Set<string>());
  const checked = useRef(false);
  const slide = useRef(new Animated.Value(0)).current;
  const signedIn = isAuthenticated && !!sessionToken;
  const visible = shouldShowInAppAlert(pathname);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const current = visible ? queue[0] : undefined;

  // A different account starts with a clean slate.
  useEffect(() => {
    seen.current = new Set();
    checked.current = false;
    setQueue([]);
  }, [sessionToken]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setAppActive(state !== "background"),
    );
    return () => subscription.remove();
  }, []);

  const refreshInbox = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["notifications", sessionToken] });
    void client.invalidateQueries({ queryKey: ["unread-notifications-badge", sessionToken] });
  }, [client, sessionToken]);

  const latest = useQuery({
    queryKey: ["in-app-alerts", sessionToken],
    queryFn: () => api.getNotifications(sessionToken!, { limit: 10, unreadOnly: true }),
    enabled: signedIn && appActive,
    retry: false,
    refetchInterval: signedIn && appActive ? IN_APP_ALERT_POLL_MS : false,
  });

  useEffect(() => {
    if (!latest.data) return;
    const fresh = takeNewAlerts(latest.data.notifications, seen.current, !checked.current);
    checked.current = true;
    if (!fresh.length) return;
    // While the Alerts screen is open the list itself updates; just note them as seen.
    if (visibleRef.current) setQueue((items) => enqueueAlerts(items, fresh));
    refreshInbox();
  }, [latest.data, refreshInbox]);

  // Opening Alerts shows everything waiting, so drop any queued popups.
  useEffect(() => {
    if (!visible) setQueue([]);
  }, [visible]);

  useEffect(() => {
    if (Platform.OS === "web" || !signedIn) return;
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const alert = alertFromPush(notification.request.content);
      refreshInbox();
      if (!alert || seen.current.has(alert.id)) return;
      seen.current.add(alert.id);
      if (!visibleRef.current) return;
      setQueue((items) => enqueueAlerts(items, [alert]));
    });
    return () => subscription.remove();
  }, [signedIn, refreshInbox]);

  const dismiss = useCallback(() => {
    Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: Platform.OS !== "web" }).start(() =>
      setQueue((items) => items.slice(1)),
    );
  }, [slide]);

  useEffect(() => {
    if (!current) return;
    slide.setValue(0);
    Animated.spring(slide, { toValue: 1, useNativeDriver: Platform.OS !== "web", friction: 8 }).start();
    const timer = setTimeout(dismiss, IN_APP_ALERT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [current, slide, dismiss]);

  if (!signedIn || !current) return null;

  const open = () => {
    const alert = current;
    setQueue((items) => items.slice(1));
    track("notification_opened", { channel: "in_app_popup", notification_type: alert.type || "unknown" });
    void api
      .markNotificationAsRead(alert.id, sessionToken!)
      .catch(() => {})
      .finally(refreshInbox);
    router.push(notificationDestination(alert) ?? "/(tabs)/notifications");
  };

  const kind = KIND_STYLE[inAppAlertKind(current.type)];
  const Icon = kind.icon;
  const more = queue.length - 1;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { top: insets.top + 8 },
        {
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
        },
      ]}
    >
      <View style={styles.card} testID="in-app-alert">
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`New alert: ${current.title}. ${current.body}`}
          accessibilityHint="Opens what this alert is about"
          onPress={open}
          style={styles.main}
        >
          <View style={[styles.icon, { backgroundColor: kind.background }]}>
            <Icon size={18} color={kind.color} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.title} numberOfLines={1}>
              {current.title}
            </Text>
            {current.body ? (
              <Text style={styles.body} numberOfLines={2}>
                {current.body}
              </Text>
            ) : null}
            {more > 0 ? <Text style={styles.more}>+{more} more</Text> : null}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Dismiss alert"
          onPress={dismiss}
          hitSlop={10}
          style={styles.close}
        >
          <X size={16} color="#64748B" />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    alignItems: "center",
    zIndex: 1000,
    elevation: 12,
  },
  card: {
    width: "100%",
    maxWidth: 480,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#0F172A",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, minHeight: 56 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: "700", color: "#111827" },
  body: { fontSize: 13, lineHeight: 18, color: "#475569", marginTop: 1 },
  more: { fontSize: 12, lineHeight: 16, color: "#94A3B8", marginTop: 2 },
  close: { padding: 12, alignSelf: "stretch", justifyContent: "center" },
});
