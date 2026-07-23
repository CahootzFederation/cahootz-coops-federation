import React from 'react';
import { ActivityIndicator, Alert, ScrollView, View, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { LogOut, Copy, Check, ChevronRight, Shield, HelpCircle, Package, CreditCard, Trash2 } from 'lucide-react-native';
import { router } from 'expo-router';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import * as Clipboard from 'expo-clipboard';
import { api } from '@/lib/api';
import { coopConfig } from '@/lib/coop-config';
import { resolveBrandColor, withAlpha } from '@/lib/brand-colors';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const config = coopConfig();
  const primaryColor = resolveBrandColor(user?.coop?.primaryColor || config.primaryColor, '#B45309');
  const accentColor = resolveBrandColor(user?.coop?.accentColor || config.accentColor, '#16A34A');
  const [copiedAddress, setCopiedAddress] = React.useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = React.useState(false);

  const handleCopyAddress = async () => {
    if (user?.walletAddress) {
      await Clipboard.setStringAsync(user.walletAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const handleLogout = async () => {
    console.log('Logout button pressed!');
    try {
      console.log('Calling logout()...');
      await logout();
      console.log('Logout completed successfully');
    } catch (error) {
      console.error('Logout error:', error);
      alert('Failed to logout. Please try again.');
    }
  };

  const performDeleteAccount = async () => {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in before deleting your account.');
      return;
    }

    if (!user.walletAddress) {
      Alert.alert('Wallet required', 'Your account needs a linked wallet before account deletion can be verified.');
      return;
    }

    setIsDeletingAccount(true);
    try {
      const result = await api.deleteAccount(user.id, user.walletAddress);
      if (result.isDemoMode) {
        await logout();
        return;
      }

      Alert.alert(
        'Account Deleted',
        result.message || 'Your account has been deleted.',
        [
          {
            text: 'OK',
            onPress: () => {
              void logout();
            },
          },
        ]
      );
    } catch (error) {
      console.error('Delete account error:', error);
      Alert.alert('Deletion failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleDeleteAccount = () => {
    if (isDeletingAccount) return;

    Alert.alert(
      'Delete Account?',
      'This will deactivate your Cahootz account and sign you out.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: () => {
            void performDeleteAccount();
          },
        },
      ]
    );
  };

  const shortenAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView className="flex-1">
        {/* Profile Header with Gradient */}
        <LinearGradient
          colors={['#111827', accentColor, primaryColor]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ paddingTop: 48, paddingBottom: 60, paddingHorizontal: 24 }}
        >
          <View className="items-center">
            {/* Avatar Circle */}
            <View className="w-24 h-24 rounded-full bg-white/20 items-center justify-center mb-4 border-4 border-white/30">
              <Text className="text-white text-3xl font-bold">
                {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text className="text-2xl font-bold text-white">
              {user?.name || 'Member'}
            </Text>
            <Text className="text-white/80 mt-1">
              {user?.email}
            </Text>
            {user?.phone && (
              <Text className="text-white/70 text-sm mt-1">
                {user.phone}
              </Text>
            )}
          </View>
        </LinearGradient>

        <View className="px-6 -mt-10">
          {/* Status Card */}
          <View className="bg-white rounded-2xl p-5 mb-6 shadow-lg" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 8 }}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <View className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: accentColor }} />
                <Text className="text-gray-600">Status:</Text>
                <Text className="text-gray-900 font-semibold ml-1 capitalize">
                  {user?.status?.toLowerCase() || 'Active'}
                </Text>
              </View>
              <View className="px-3 py-1 rounded-full" style={{ backgroundColor: withAlpha(accentColor, '1A') }}>
                <Text className="text-sm font-medium capitalize" style={{ color: accentColor }}>
                  {user?.roles?.join(', ') || 'Member'}
                </Text>
              </View>
            </View>
          </View>

          {/* Wallet Address */}
          {user?.walletAddress && (
            <View className="bg-white rounded-2xl p-5 mb-4">
              <Text className="text-sm text-gray-500 mb-3 font-medium">Wallet Address</Text>
              <TouchableOpacity
                onPress={handleCopyAddress}
                className="flex-row items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-100"
              >
                <Text className="text-sm font-mono text-gray-700">
                  {shortenAddress(user.walletAddress)}
                </Text>
                {copiedAddress ? (
                  <View className="flex-row items-center">
                    <Check size={16} color="#10B981" />
                    <Text className="text-green-600 text-xs ml-1">Copied!</Text>
                  </View>
                ) : (
                  <Copy size={16} color="#6B7280" />
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Quick Actions */}
          <View className="bg-white rounded-2xl overflow-hidden mb-4">
            <Text className="text-sm text-gray-500 px-5 pt-5 pb-3 font-medium">Activity</Text>

            <TouchableOpacity
              onPress={() => router.push('/(authenticated)/orders' as any)}
              className="flex-row items-center px-5 py-4 border-b border-gray-100 active:bg-gray-50"
            >
              <View className="w-11 h-11 rounded-xl items-center justify-center mr-4" style={{ backgroundColor: withAlpha(accentColor, '1A') }}>
                <Package size={22} color={accentColor} />
              </View>
              <View className="flex-1">
                <Text className="text-base text-gray-900 font-medium">Order History</Text>
                <Text className="text-sm text-gray-500">View your store purchases</Text>
              </View>
              <ChevronRight size={20} color="#D1D5DB" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/(authenticated)/payment-methods' as any)}
              className="flex-row items-center px-5 py-4 active:bg-gray-50"
            >
              <View className="w-11 h-11 rounded-xl items-center justify-center mr-4" style={{ backgroundColor: withAlpha(accentColor, '1A') }}>
                <CreditCard size={22} color={accentColor} />
              </View>
              <View className="flex-1">
                <Text className="text-base text-gray-900 font-medium">Payment Methods</Text>
                <Text className="text-sm text-gray-500">Add or manage saved cards</Text>
              </View>
              <ChevronRight size={20} color="#D1D5DB" />
            </TouchableOpacity>
          </View>

          {/* Account Info */}
          <View className="bg-white rounded-2xl overflow-hidden mb-4">
            <Text className="text-sm text-gray-500 px-5 pt-5 pb-3 font-medium">Account</Text>

            <View className="px-5 py-4 border-b border-gray-100">
              <Text className="text-xs text-gray-400 uppercase tracking-wide mb-1">Member Since</Text>
              <Text className="text-base text-gray-900">
                {user?.createdAt?.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }) || 'N/A'}
              </Text>
            </View>

            {user?.coop && (
              <View className="px-5 py-4">
                <Text className="text-xs text-gray-400 uppercase tracking-wide mb-1">Cooperative</Text>
                <Text className="text-base text-gray-900 font-medium">{user.coop.name}</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={handleDeleteAccount}
              disabled={isDeletingAccount}
              className="flex-row items-center px-5 py-4 border-t border-red-100 active:bg-red-50"
            >
              <View className="w-11 h-11 rounded-xl bg-red-50 items-center justify-center mr-4">
                {isDeletingAccount ? (
                  <ActivityIndicator size="small" color="#DC2626" />
                ) : (
                  <Trash2 size={22} color="#DC2626" />
                )}
              </View>
              <View className="flex-1">
                <Text className="text-base text-red-700 font-semibold">
                  {isDeletingAccount ? 'Deleting Account...' : 'Delete Account'}
                </Text>
                <Text className="text-sm text-red-500">Deactivate this account</Text>
              </View>
              <ChevronRight size={20} color="#FCA5A5" />
            </TouchableOpacity>
          </View>

          {/* Support & Help */}
          <View className="bg-white rounded-2xl overflow-hidden mb-6">
            <TouchableOpacity
              className="flex-row items-center px-5 py-4 border-b border-gray-100 active:bg-gray-50"
            >
              <View className="w-11 h-11 rounded-xl bg-gray-100 items-center justify-center mr-4">
                <HelpCircle size={22} color="#6B7280" />
              </View>
              <View className="flex-1">
                <Text className="text-base text-gray-900 font-medium">Help & Support</Text>
              </View>
              <ChevronRight size={20} color="#D1D5DB" />
            </TouchableOpacity>

            <TouchableOpacity
              className="flex-row items-center px-5 py-4 active:bg-gray-50"
            >
              <View className="w-11 h-11 rounded-xl bg-gray-100 items-center justify-center mr-4">
                <Shield size={22} color="#6B7280" />
              </View>
              <View className="flex-1">
                <Text className="text-base text-gray-900 font-medium">Privacy & Security</Text>
              </View>
              <ChevronRight size={20} color="#D1D5DB" />
            </TouchableOpacity>
          </View>

          {/* Logout Button */}
          <TouchableOpacity
            onPress={handleLogout}
            className="bg-red-50 border border-red-200 flex-row items-center justify-center gap-2 p-4 rounded-2xl active:bg-red-100 mb-8"
            activeOpacity={0.8}
          >
            <LogOut size={20} color="#DC2626" />
            <Text className="text-red-600 font-semibold">
              Sign Out
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
