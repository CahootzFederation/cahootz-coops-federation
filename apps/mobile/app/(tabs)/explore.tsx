import { ScrollView, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { CreditCard, Plus, User, Wallet, History, Bell } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';

export default function ExploreScreen() {
  const { user } = useAuth();

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: '#FFFBEB' }}>
      <View className="px-4 pt-14 pb-4">
        <Text className="text-2xl font-bold text-gray-900">
          {user?.name ? `${user.name.split(' ')[0]}'s Profile` : 'Profile'}
        </Text>
        <Text className="text-gray-500 mt-1">Manage your wallet and account settings</Text>
      </View>

      <View className="mx-4 bg-gradient-to-r from-red-600 to-amber-600 rounded-2xl p-5 shadow-lg">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-white text-xl font-bold">Need to top up your wallet?</Text>
            <Text className="text-white/80 text-sm mt-1">
              Add funds instantly with your saved card.
            </Text>
          </View>
          <View className="w-12 h-12 rounded-xl bg-white/20 items-center justify-center">
            <Wallet size={22} color="#FFFFFF" />
          </View>
        </View>

        <TouchableOpacity
          onPress={() => router.push('/(authenticated)/fund-wallet')}
          className="mt-4 bg-white rounded-xl py-3 px-4 flex-row items-center justify-center"
          activeOpacity={0.85}
        >
          <Plus size={18} color="#FF6B00" />
          <Text className="text-primary font-semibold ml-2">Add Money</Text>
        </TouchableOpacity>
      </View>

      <View className="mx-4 mt-4 mb-8 bg-white rounded-2xl border border-amber-100 overflow-hidden">
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/wallet')}
          className="p-4 flex-row items-center border-b border-gray-100"
          activeOpacity={0.75}
        >
          <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center mr-3">
            <Wallet size={20} color="#FF6B00" />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 font-semibold">Wallet</Text>
            <Text className="text-gray-500 text-sm">Balance, address, and wallet actions</Text>
          </View>
          <Text className="text-gray-400 text-xl">›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/payment-methods')}
          className="p-4 flex-row items-center border-b border-gray-100"
          activeOpacity={0.75}
        >
          <View className="w-10 h-10 rounded-full bg-blue-100 items-center justify-center mr-3">
            <CreditCard size={20} color="#2563EB" />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 font-semibold">Payment Methods</Text>
            <Text className="text-gray-500 text-sm">Add or update cards for funding</Text>
          </View>
          <Text className="text-gray-400 text-xl">›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/(authenticated)/history')}
          className="p-4 flex-row items-center border-b border-gray-100"
          activeOpacity={0.75}
        >
          <View className="w-10 h-10 rounded-full bg-emerald-100 items-center justify-center mr-3">
            <History size={20} color="#059669" />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 font-semibold">Transaction History</Text>
            <Text className="text-gray-500 text-sm">View transfers and order activity</Text>
          </View>
          <Text className="text-gray-400 text-xl">›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/(authenticated)/notifications')}
          className="p-4 flex-row items-center"
          activeOpacity={0.75}
        >
          <View className="w-10 h-10 rounded-full bg-purple-100 items-center justify-center mr-3">
            <Bell size={20} color="#7C3AED" />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 font-semibold">Notifications</Text>
            <Text className="text-gray-500 text-sm">See payment and wallet updates</Text>
          </View>
          <Text className="text-gray-400 text-xl">›</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}