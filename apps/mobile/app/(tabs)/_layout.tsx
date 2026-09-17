import { Platform, useWindowDimensions } from "react-native";
import { Tabs } from "expo-router";
import { Bell, LayoutGrid, Scale, UserCircle } from "lucide-react-native";
import { useAuth } from '@/contexts/auth-context';

export default function TabLayout() {
  const { fontScale } = useWindowDimensions();
  const { isAuthenticated } = useAuth();
  return (
    <Tabs
      tabBar={isAuthenticated ? () => null : undefined}
      screenOptions={{
        tabBarActiveTintColor: "#FF6B00",
        tabBarInactiveTintColor: "#64748B",
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          borderTopColor: "#F0F2F5",
          borderTopWidth: 1,
          paddingTop: 7,
          paddingBottom: Platform.OS === "ios" ? 24 : 8,
          height:
            (Platform.OS === "ios" ? 96 : 72) + Math.max(0, fontScale - 1) * 20,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          lineHeight: 14,
          flexShrink: 0,
          width: "100%",
          marginHorizontal: 0,
          fontWeight: "700",
          marginTop: 3,
        },
        headerShown: false,
      }}
    >
      {/* ===== VISIBLE TABS ===== */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Commons",
          tabBarIcon: ({ color, size }) => (
            <LayoutGrid size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Alerts",
          tabBarIcon: ({ color, size }) => <Bell size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="proposals"
        options={{
          title: "Proposals",
          tabBarIcon: ({ color, size }) => <Scale size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "You",
          tabBarIcon: ({ color, size }) => (
            <UserCircle size={size} color={color} />
          ),
        }}
      />

      {/* ===== HIDDEN - Not ready yet ===== */}
      <Tabs.Screen name="messages" options={{ href: null }} />
      <Tabs.Screen name="proposal-detail" options={{ href: null }} />
      <Tabs.Screen name="store" options={{ href: null }} />
      <Tabs.Screen name="community" options={{ href: null }} />
      <Tabs.Screen name="explore" options={{ href: null }} />
      <Tabs.Screen name="events" options={{ href: null }} />
      <Tabs.Screen name="transfer" options={{ href: null }} />
      <Tabs.Screen name="history" options={{ href: null }} />
      <Tabs.Screen name="buy" options={{ href: null }} />
    </Tabs>
  );
}
