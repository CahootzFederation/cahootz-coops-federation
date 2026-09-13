import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/lib/api";
import { notificationDestination } from "@/lib/notification-navigation";
import { useIsFocused } from "@react-navigation/native";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowLeft, Bell, Settings } from "lucide-react-native";

import type {
  AccountNotification,
  NotificationCategory,
  NotificationCursor,
} from "@repo/validators/notification";
import {
  notificationCategories,
  notificationCategoryLabels,
} from "@repo/validators/notification";

export const alertStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F6F7F8" },
  content: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 24, fontWeight: "800", color: "#111827" },
  text: { fontSize: 15, lineHeight: 23, color: "#475569", flexShrink: 1 },
  heading: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
    color: "#111827",
    flexShrink: 1,
  },
  card: {
    borderRadius: 14,
    padding: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 8,
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "#FFF7ED",
  },
  buttonText: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "700",
    color: "#9A3412",
    textAlign: "center",
  },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  error: { color: "#B91C1C", fontSize: 14, lineHeight: 22 },
});
const s = alertStyles;

export function AlertButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, disabled && { opacity: 0.5 }]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function timeAgo(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function NotificationScreen({
  back = false,
}: {
  back?: boolean;
}) {
  const { sessionToken, isLoading, isAuthenticated } = useAuth();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const client = useQueryClient();
  const [category, setCategory] = useState<NotificationCategory | undefined>();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [actionError, setActionError] = useState("");
  const query = useInfiniteQuery({
    queryKey: ["notifications", sessionToken, category, unreadOnly],
    initialPageParam: undefined as NotificationCursor | undefined,
    queryFn: ({ pageParam }) =>
      api.getNotifications(sessionToken!, {
        category,
        unreadOnly,
        cursor: pageParam,
      }),
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: !!sessionToken && focused,
    retry: false,
    refetchInterval: focused ? 30000 : false,
  });
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      setActionError("");
      if (sessionToken) void refetch();
    }, [sessionToken, refetch]),
  );
  const markRead = useMutation({
    mutationFn: async (notification: AccountNotification | null) => {
      if (notification) {
        if (!notification.read)
          await api.markNotificationAsRead(notification.id, sessionToken!);
      } else await api.markAllNotificationsAsRead(sessionToken!);
    },
    onMutate: () => setActionError(""),
    onSuccess: async (_, notification) => {
      await client.invalidateQueries({
        queryKey: ["notifications", sessionToken],
      });
      const destination = notification && notificationDestination(notification);
      if (destination) router.push(destination);
    },
    onError: () =>
      setActionError("Could not update your alerts. Please try again."),
  });
  const page = query.data?.pages[0];
  const notifications = query.data?.pages.flatMap((p) => p.notifications) || [];
  const signedIn = isAuthenticated && !!sessionToken;

  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={[
        s.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
      ]}
      refreshControl={
        signedIn ? (
          <RefreshControl
            refreshing={query.isRefetching && !query.isFetchingNextPage}
            onRefresh={() => void query.refetch()}
          />
        ) : undefined
      }
    >
      <View style={s.header}>
        {back ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={s.button}
            onPress={() =>
              router.canGoBack()
                ? router.back()
                : router.replace("/(tabs)/notifications")
            }
          >
            <ArrowLeft size={22} color="#9A3412" />
          </TouchableOpacity>
        ) : (
          <Bell size={26} color="#C2410C" />
        )}
        <View style={s.grow}>
          <Text style={s.title}>Alerts</Text>
          <Text style={s.text}>Your account activity</Text>
        </View>
        {signedIn && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Notification settings"
            style={s.button}
            onPress={() =>
              router.push("/(authenticated)/notification-settings")
            }
          >
            <Settings size={22} color="#9A3412" />
          </TouchableOpacity>
        )}
      </View>
      {isLoading ? (
        <ActivityIndicator
          accessibilityLabel="Loading account"
          color="#C2410C"
        />
      ) : !signedIn ? (
        <View style={s.card}>
          <Text style={s.heading}>Sign in to see your alerts</Text>
          <Text style={s.text}>
            Your personal activity and notification settings will appear here.
          </Text>
          <AlertButton
            label="Sign in"
            onPress={() => router.push("/(tabs)/wallet")}
          />
        </View>
      ) : (
        <>
          <View style={s.card}>
            <View style={[s.row, { justifyContent: "space-between" }]}>
              <Text style={s.heading}>
                {page
                  ? `${page.unreadCount.toLocaleString()} unread`
                  : "Your alerts"}
              </Text>
              <AlertButton
                label={markRead.isPending ? "Updating…" : "Mark all read"}
                disabled={!page?.unreadCount || markRead.isPending}
                onPress={() => markRead.mutate(null)}
              />
            </View>
            <View style={s.row}>
              {[undefined, ...notificationCategories].map((value) => (
                <TouchableOpacity
                  key={value || "all"}
                  accessibilityRole="button"
                  accessibilityState={{ selected: category === value }}
                  aria-pressed={category === value}
                  onPress={() => setCategory(value)}
                  style={[
                    s.button,
                    {
                      borderWidth: 1,
                      borderColor: category === value ? "#C2410C" : "#E5E7EB",
                      backgroundColor:
                        category === value ? "#FFF7ED" : "#FFFFFF",
                      maxWidth: "100%",
                    },
                  ]}
                >
                  <Text style={s.buttonText}>
                    {value
                      ? (
                          {
                            payments: "Payments",
                            orders: "Orders",
                            other: "Other",
                          } as Partial<Record<NotificationCategory, string>>
                        )[value] || notificationCategoryLabels[value]
                      : "All"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.row}>
              <TouchableOpacity
                accessibilityRole="button"
                aria-pressed={unreadOnly}
                accessibilityState={{ selected: unreadOnly }}
                style={s.button}
                onPress={() => setUnreadOnly((value) => !value)}
              >
                <Text style={s.buttonText}>
                  {unreadOnly ? "✓ Unread only" : "Show unread only"}
                </Text>
              </TouchableOpacity>
              <AlertButton
                label="Refresh"
                disabled={query.isFetching}
                onPress={() => void query.refetch()}
              />
              {page && (
                <Text style={s.text}>
                  {page.totalCount.toLocaleString()}{" "}
                  {page.totalCount === 1 ? "alert" : "alerts"}
                </Text>
              )}
            </View>
          </View>
          {!!actionError && (
            <Text accessibilityRole="alert" style={s.error}>
              {actionError}
            </Text>
          )}
          {query.isPending && (
            <ActivityIndicator
              accessibilityLabel="Loading alerts"
              color="#C2410C"
            />
          )}
          {query.isError && (
            <View style={s.card}>
              <Text accessibilityRole="alert" style={s.error}>
                Could not load alerts. Please try again.
              </Text>
              <AlertButton
                label="Retry"
                onPress={() =>
                  void (query.isFetchNextPageError
                    ? query.fetchNextPage()
                    : query.refetch())
                }
              />
            </View>
          )}
          {!query.isPending && !query.isError && notifications.length === 0 && (
            <View style={s.card}>
              <Text style={s.heading}>
                {category || unreadOnly
                  ? "No matching alerts"
                  : "No alerts yet"}
              </Text>
              <Text style={s.text}>
                {category || unreadOnly
                  ? "Try another filter or check back later."
                  : "Updates from your real account activity will appear here."}
              </Text>
            </View>
          )}
          {notifications.map((notification) => (
            <TouchableOpacity
              key={notification.id}
              accessibilityRole="button"
              accessibilityLabel={`${notification.read ? "" : "Unread: "}${notification.title}`}
              disabled={markRead.isPending}
              onPress={() => markRead.mutate(notification)}
              style={[
                s.card,
                !notification.read && {
                  borderColor: "#FDBA74",
                  backgroundColor: "#FFFBF5",
                },
              ]}
            >
              <View style={s.row}>
                <Text style={s.text}>{timeAgo(notification.createdAt)}</Text>
                {!notification.read && <Text style={s.buttonText}>Unread</Text>}
              </View>
              <Text style={s.heading}>{notification.title}</Text>
              <Text style={s.text}>{notification.body}</Text>
              {notificationDestination(notification) ? (
                <Text style={s.buttonText}>View activity →</Text>
              ) : !notification.read ? (
                <Text style={s.buttonText}>Mark as read</Text>
              ) : null}
            </TouchableOpacity>
          ))}
          {query.hasNextPage && (
            <AlertButton
              label={query.isFetchingNextPage ? "Loading…" : "Load more"}
              disabled={query.isFetching}
              onPress={() => void query.fetchNextPage()}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}
