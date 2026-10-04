import React from "react";
import { Platform, TouchableOpacity, View } from "react-native";

/** An accessible on/off switch: a native switch role on web, an accessibility switch on device. */
export function PreferenceSwitch({
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
