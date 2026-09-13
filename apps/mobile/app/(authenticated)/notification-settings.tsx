import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import {
  AlertButton,
  alertStyles as s,
} from "@/components/notification-screen";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/lib/api";
import {
  getPushPermissionStatus,
  registerForNativePushNotifications,
} from "@/lib/push-notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { NotificationPreferences } from "@repo/validators/notification";
import {
  notificationCategories,
  notificationCategoryLabels,
} from "@repo/validators/notification";

function PreferenceSwitch({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const track = (
    <View
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        padding: 3,
        backgroundColor: value ? "#C2410C" : "#64748B",
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: "#FFFFFF",
          alignSelf: value ? "flex-end" : "flex-start",
        }}
      />
    </View>
  );
  // A native HTML button supplies Space/Enter behavior for the web switch role.
  if (Platform.OS === "web") {
    return (
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        style={{
          minWidth: 52,
          minHeight: 44,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          border: 0,
          padding: 0,
          background: "transparent",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {track}
      </button>
    );
  }
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={{
        minWidth: 52,
        minHeight: 44,
        justifyContent: "center",
        alignItems: "center",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {track}
    </TouchableOpacity>
  );
}

export default function NotificationSettings() {
  const { sessionToken, user } = useAuth();
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const [permission, setPermission] = useState("Checking device permission…");
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  const queryKey = ["notification-preferences", sessionToken];
  const query = useQuery({
    queryKey,
    queryFn: () => api.getNotificationPreferences(sessionToken!),
    enabled: !!sessionToken,
    retry: false,
  });
  const refreshPermission = useCallback(async () => {
    try {
      setPermission(await getPushPermissionStatus());
    } catch {
      setPermission("Could not check device permission.");
    }
  }, []);
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      void refreshPermission();
      if (sessionToken) void refetch();
    }, [refreshPermission, sessionToken, refetch]),
  );
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshPermission();
    });
    return () => listener.remove();
  }, [refreshPermission]);
  const registerDevice = async () => {
    if (!sessionToken) return;
    setDeviceBusy(true);
    setDeviceError("");
    try {
      await registerForNativePushNotifications(
        sessionToken,
        user?.coop?.id || "cahootz",
      );
      await refreshPermission();
    } catch {
      setDeviceError("Could not register this device. Try again.");
    } finally {
      setDeviceBusy(false);
    }
  };
  const mutation = useMutation({
    mutationFn: (change: Partial<NotificationPreferences>) =>
      api.updateNotificationPreferences(sessionToken!, change),
    onSuccess: (saved, change) => {
      client.setQueryData(queryKey, saved);
      if (change.pushEnabled && Platform.OS !== "web") void registerDevice();
    },
  });
  const preferences = query.data;
  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={[
        s.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
      ]}
    >
      <View style={{ alignItems: "flex-start" }}>
        <AlertButton
          label="Back to alerts"
          onPress={() => router.replace("/(tabs)/notifications")}
        />
      </View>
      <Text style={s.title}>Notification settings</Text>
      <Text style={s.text}>
        Choose which push notifications you receive across your devices. All
        activity stays in your Alerts inbox.
      </Text>
      {!sessionToken ? (
        <Text style={s.text}>Sign in to change your settings.</Text>
      ) : query.isPending ? (
        <ActivityIndicator
          accessibilityLabel="Loading settings"
          color="#C2410C"
        />
      ) : (
        <>
          {query.isError && (
            <View style={s.card}>
              <Text accessibilityRole="alert" style={s.error}>
                Could not load notification settings.
              </Text>
              <AlertButton label="Retry" onPress={() => void query.refetch()} />
            </View>
          )}
          {preferences && (
            <>
              <View style={s.card}>
                <View style={s.header}>
                  <View style={s.grow}>
                    <Text style={s.heading}>Push notifications</Text>
                    <Text style={s.text}>
                      Allow notifications on your devices.
                    </Text>
                  </View>
                  <PreferenceSwitch
                    label="Push notifications"
                    value={preferences.pushEnabled}
                    disabled={mutation.isPending}
                    onChange={(pushEnabled) => mutation.mutate({ pushEnabled })}
                  />
                </View>
              </View>
              <View style={s.card}>
                <Text style={s.heading}>Notification categories</Text>
                {!preferences.pushEnabled && (
                  <Text style={s.text}>
                    Push is off. Your category choices are saved for when you
                    turn it back on.
                  </Text>
                )}
                {notificationCategories.map((category) => (
                  <View
                    key={category}
                    style={[s.header, { paddingVertical: 10, minHeight: 52 }]}
                  >
                    <Text style={[s.heading, s.grow]}>
                      {notificationCategoryLabels[category]}
                    </Text>
                    <PreferenceSwitch
                      label={notificationCategoryLabels[category]}
                      value={preferences[category]}
                      disabled={mutation.isPending || !preferences.pushEnabled}
                      onChange={(value) =>
                        mutation.mutate({ [category]: value })
                      }
                    />
                  </View>
                ))}
              </View>
              {mutation.isPending && (
                <Text accessibilityLiveRegion="polite" style={s.text}>
                  Saving…
                </Text>
              )}
              {mutation.isSuccess && !mutation.isPending && (
                <Text accessibilityLiveRegion="polite" style={s.text}>
                  Settings saved.
                </Text>
              )}
              {mutation.isError && (
                <View style={s.card}>
                  <Text accessibilityRole="alert" style={s.error}>
                    Could not save your settings. Your previous choices are
                    still active.
                  </Text>
                  <AlertButton
                    label="Retry save"
                    onPress={() => mutation.mutate(mutation.variables!)}
                  />
                </View>
              )}
            </>
          )}
        </>
      )}
      <View style={s.card}>
        <Text style={s.heading}>This device</Text>
        <Text style={s.text}>{permission}</Text>
        {Platform.OS !== "web" && (
          <>
            <AlertButton
              label={deviceBusy ? "Registering…" : "Enable on this device"}
              disabled={
                !sessionToken ||
                !preferences?.pushEnabled ||
                deviceBusy ||
                mutation.isPending
              }
              onPress={() => void registerDevice()}
            />
            <AlertButton
              label="Open device settings"
              onPress={() => {
                void Linking.openSettings().catch(() =>
                  setDeviceError(
                    "Could not open device settings. Open Settings on your device manually.",
                  ),
                );
              }}
            />
          </>
        )}
        {!!deviceError && (
          <Text accessibilityRole="alert" style={s.error}>
            {deviceError}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}
