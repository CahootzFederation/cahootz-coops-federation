import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { Grid3X3, Home, User, FileText } from 'lucide-react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function AuthenticatedLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#B45309',
        tabBarInactiveTintColor: isDark ? '#6B7280' : '#9CA3AF',
        tabBarStyle: {
          backgroundColor: isDark ? '#111827' : '#FFFFFF',
          borderTopWidth: 0,
          elevation: 20,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.1,
          shadowRadius: 12,
          height: 85,
          paddingTop: 8,
          paddingBottom: 28,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 4,
        },
        tabBarIconStyle: {
          marginTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="apps"
        options={{
          title: 'Apps',
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? {
              backgroundColor: '#FEF3C7',
              borderRadius: 12,
              padding: 8,
            } : { padding: 8 }}>
              <Grid3X3 color={color} size={22} strokeWidth={focused ? 2.5 : 2} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="home"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? {
              backgroundColor: '#FEF3C7',
              borderRadius: 12,
              padding: 8,
            } : { padding: 8 }}>
              <Home color={color} size={22} strokeWidth={focused ? 2.5 : 2} />
            </View>
          ),
        }}
      />


      <Tabs.Screen
        name="proposals"
        options={{
          title: 'Proposals',
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? {
              backgroundColor: '#FEF3C7',
              borderRadius: 12,
              padding: 8,
            } : { padding: 8 }}>
              <FileText color={color} size={22} strokeWidth={focused ? 2.5 : 2} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? {
              backgroundColor: '#FEF3C7',
              borderRadius: 12,
              padding: 8,
            } : { padding: 8 }}>
              <User color={color} size={22} strokeWidth={focused ? 2.5 : 2} />
            </View>
          ),
        }}
      />
      {/* Hide these screens from tabs - accessed via navigation */}
      <Tabs.Screen name="stores" options={{ href: null }} />
      <Tabs.Screen name="directory" options={{ href: null }} />
      <Tabs.Screen name="stripe-onboarding" options={{ href: null }} />
      <Tabs.Screen name="apply-sc-verification" options={{ href: null }} />

      <Tabs.Screen name="store-orders" options={{ href: null }} />
      <Tabs.Screen name="pay" options={{ href: null }} />
      <Tabs.Screen name="scan-pay" options={{ href: null }} />
      <Tabs.Screen name="quick-pay" options={{ href: null }} />
      <Tabs.Screen name="accept-payment" options={{ href: null }} />
      <Tabs.Screen name="history" options={{ href: null }} />
      <Tabs.Screen name="bank-accounts" options={{ href: null }} />
      <Tabs.Screen name="payment-methods" options={{ href: null }} />
      <Tabs.Screen name="store-detail" options={{ href: null }} />
      <Tabs.Screen name="product-detail" options={{ href: null }} />
      <Tabs.Screen name="apply-store" options={{ href: null }} />
      <Tabs.Screen name="my-store" options={{ href: null }} />
      <Tabs.Screen name="my-stores" options={{ href: null }} />
      <Tabs.Screen name="store-payments" options={{ href: null }} />
      <Tabs.Screen name="add-product" options={{ href: null }} />
      <Tabs.Screen name="edit-product" options={{ href: null }} />
      <Tabs.Screen name="cart" options={{ href: null }} />
      <Tabs.Screen name="checkout" options={{ href: null }} />
      <Tabs.Screen name="orders" options={{ href: null }} />
      <Tabs.Screen name="order-detail" options={{ href: null }} />
      <Tabs.Screen name="fund-wallet" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="proposal-detail" options={{ href: null }} />
    </Tabs>
  );
}
