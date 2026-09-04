import { router } from 'expo-router';
import { Bell, CheckCircle2, HandCoins, Menu, MessageCircle, PackageSearch, Scale, UserCircle, Wallet } from 'lucide-react-native';
import { ScrollView, TouchableOpacity, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';

const SOCIAL_THEME = {
  paper: '#F6F7F8',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  ink: '#111827',
  muted: '#6B7280',
};

const alerts = [
  {
    title: 'Proposal #18 Passed!',
    body: 'The Wood-fire Kiln Upgrade in Oakland Commons reached quorum with 92% YES votes.',
    meta: '12m ago',
    action: 'View Vote Tally',
    icon: Scale,
    color: SOCIAL_THEME.primary,
  },
  {
    title: 'Received 15 SC Support',
    body: 'Elena Rostova supported your shared cargo van logistics post.',
    meta: '1h ago',
    action: null,
    icon: HandCoins,
    color: '#047857',
  },
  {
    title: 'New Resource Match',
    body: 'East Bay Bakery listed 40 sq ft cold storage matching your profile request.',
    meta: '3h ago',
    action: null,
    icon: PackageSearch,
    color: '#2563EB',
  },
  {
    title: 'Kofi Mensah tagged you',
    body: 'A rooftop harvest thread mentioned your packaging offer.',
    meta: '5h ago',
    action: null,
    icon: Bell,
    color: '#64748B',
  },
];

export default function NotificationsScreen() {
  const { isAuthenticated, user } = useAuth();
  const accountName = user?.name?.trim() || user?.email?.split('@')[0] || 'member';

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: SOCIAL_THEME.paper }} contentContainerStyle={{ paddingBottom: 28 }}>
      <View className="border-b border-gray-200 bg-white px-3 pt-7 pb-2">
        <View className="flex-row items-center gap-2">
          <TouchableOpacity
            onPress={() => router.push('/(tabs)' as any)}
            className="h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
            accessibilityLabel="Back to commons"
          >
            <Menu size={18} color="#1F2937" strokeWidth={2.6} />
          </TouchableOpacity>
          <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: SOCIAL_THEME.primary }}>
            <Bell size={17} color="#FFFFFF" strokeWidth={2.6} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="min-w-0 text-base font-black text-gray-950" numberOfLines={1}>
              Alerts
            </Text>
            <Text className="mt-0.5 text-xs font-semibold text-slate-600" numberOfLines={1}>
              Governance, payments, matches & mentions
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/messages' as any)}
            className="h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
            accessibilityLabel="Open direct messages"
          >
            <MessageCircle size={16} color="#334155" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/wallet' as any)}
            className="h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
            accessibilityLabel="Open profile"
          >
            <UserCircle size={16} color="#334155" />
          </TouchableOpacity>
        </View>
      </View>

      <View className="px-5 py-4">
        <View className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-black text-gray-900">
              {isAuthenticated ? `Hey, ${accountName}` : 'Browse now, sign in when you want to act'}
            </Text>
            <Text className="text-xs font-black" style={{ color: SOCIAL_THEME.primary }}>Mark all read</Text>
          </View>
          <View className="mt-3 flex-row gap-2">
            {['All (4)', 'Governance', 'Payments', 'Matches'].map((filter, index) => (
              <View
                key={filter}
                className="rounded-full border px-3 py-1.5"
                style={{
                  backgroundColor: index === 0 ? SOCIAL_THEME.primarySoft : '#FFFFFF',
                  borderColor: index === 0 ? '#FED7AA' : '#E5E7EB',
                }}
              >
                <Text className="text-xs font-bold" style={{ color: index === 0 ? SOCIAL_THEME.primary : SOCIAL_THEME.muted }}>
                  {filter}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className="gap-3">
          {alerts.map((alert) => {
            const Icon = alert.icon;
            return (
              <TouchableOpacity
                key={alert.title}
                className="rounded-xl border border-gray-200 bg-white p-4"
                activeOpacity={0.75}
              >
                <View className="flex-row gap-3">
                  <View className="h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: SOCIAL_THEME.paper }}>
                    <Icon size={21} color={alert.color} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <View className="flex-row items-start justify-between gap-2">
                      <Text className="flex-1 font-black text-gray-900">{alert.title}</Text>
                      <Text className="text-xs font-semibold text-gray-500">{alert.meta}</Text>
                    </View>
                    <Text className="mt-1 text-sm leading-5 text-gray-600">{alert.body}</Text>
                    {alert.action ? (
                      <View className="mt-3 flex-row items-center gap-1">
                        <CheckCircle2 size={14} color={SOCIAL_THEME.primary} />
                        <Text className="text-xs font-black" style={{ color: SOCIAL_THEME.primary }}>
                          {alert.action}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          onPress={() => router.push('/(tabs)/wallet' as any)}
          className="mt-4 flex-row items-center gap-3 rounded-xl border border-gray-200 bg-white p-4"
        >
          <View className="h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: SOCIAL_THEME.primarySoft }}>
            <Wallet size={21} color={SOCIAL_THEME.primary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="font-black text-gray-900">Open You / Wallet</Text>
            <Text className="mt-1 text-sm text-gray-600">Profile, rewards, payment tools, and settings.</Text>
          </View>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
