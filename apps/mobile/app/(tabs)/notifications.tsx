import { router } from 'expo-router';
import { Bell, MessageCircle, Sparkles, UserCircle, Wallet } from 'lucide-react-native';
import { ScrollView, TouchableOpacity, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';

const SOCIAL_THEME = {
  paper: '#F6F7F8',
  primary: '#F97316',
  primarySoft: '#FFF7ED',
  ink: '#111827',
  muted: '#6B7280',
};

const alerts = [
  {
    title: 'Someone replied to a social thread',
    body: 'The conversation about what people are building this week has new comments.',
    icon: MessageCircle,
    color: SOCIAL_THEME.primary,
  },
  {
    title: 'A thread is ready for action',
    body: 'A workspace post was connected to related artist and venue conversations.',
    icon: Sparkles,
    color: '#047857',
  },
  {
    title: 'Member business activity',
    body: 'A business shoutout is getting attention in Cahootz Commons.',
    icon: Bell,
    color: '#DC2626',
  },
];

export default function NotificationsScreen() {
  const { isAuthenticated, user } = useAuth();
  const accountName = user?.name?.trim() || user?.email?.split('@')[0] || 'member';

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: SOCIAL_THEME.paper }} contentContainerStyle={{ paddingBottom: 28 }}>
      <View className="border-b border-gray-200 bg-white px-5 pt-14 pb-5">
        <View className="flex-row items-center justify-between">
          <View className="min-w-0 flex-1 pr-3">
            <Text className="text-xs font-black uppercase text-gray-500">c/Cahootz</Text>
            <Text className="text-2xl font-black text-gray-950">Alerts</Text>
            <Text className="text-sm text-gray-600">Replies, mentions, trending threads, and wallet activity</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/wallet' as any)}
            className="h-11 w-11 items-center justify-center rounded-xl"
            style={{ backgroundColor: SOCIAL_THEME.primary }}
          >
            <UserCircle size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <View className="px-5 py-4">
        <View className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
          <Text className="text-base font-black text-gray-900">
            {isAuthenticated ? `Hey, ${accountName}` : 'Browse now, sign in when you want to act'}
          </Text>
          <Text className="mt-1 text-sm leading-5 text-gray-600">
            Cahootz keeps the feed social and only nudges threads forward when something needs attention.
          </Text>
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
                    <Text className="font-black text-gray-900">{alert.title}</Text>
                    <Text className="mt-1 text-sm leading-5 text-gray-600">{alert.body}</Text>
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
