import React from 'react';
import { ActivityIndicator, Alert, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Bell,
  Check,
  ChevronRight,
  CircleEllipsis,
  Copy,
  HelpCircle,
  LogOut,
  Shield,
  Store,
  Trash2,
  UserCircle,
  Vote,
  Wallet,
} from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

const PROFILE_THEME = {
  paper: '#F8FAFC',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#F0F2F5',
  muted: '#64748B',
  success: '#16A34A',
};

type NavItem = {
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  href?: string;
  destructive?: boolean;
  onPress?: () => void;
};

export default function AccountProfileScreen() {
  const { user, logout } = useAuth();
  const [copiedAddress, setCopiedAddress] = React.useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = React.useState(false);

  const displayName = user?.name?.trim() || user?.email?.split('@')[0] || 'Member';
  const handle = user?.email?.split('@')[0]?.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'member';
  const commonsName = user?.coop?.name || 'Oakland Commons';
  const roleLabel = user?.roles?.join(', ') || 'Member';
  const statusLabel = user?.status?.toLowerCase() || 'active';

  const handleCopyAddress = async () => {
    if (!user?.walletAddress) return;
    await Clipboard.setStringAsync(user.walletAddress);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout error:', error);
      Alert.alert('Sign out failed', 'Please try again.');
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

      Alert.alert('Account Deleted', result.message || 'Your account has been deleted.', [
        { text: 'OK', onPress: () => void logout() },
      ]);
    } catch (error) {
      console.error('Delete account error:', error);
      Alert.alert('Deletion failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleDeleteAccount = () => {
    if (isDeletingAccount) return;

    Alert.alert('Delete Account?', 'This will deactivate your Cahootz account and sign you out.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Account', style: 'destructive', onPress: () => void performDeleteAccount() },
    ]);
  };

  const shortenAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(tabs)' as any);
  };

  const navItems: NavItem[] = [
    {
      label: 'Wallet',
      description: 'SC balance, wallet address, cards, and funding',
      icon: Wallet,
      href: '/(authenticated)/payment-methods',
    },
    {
      label: 'Alerts',
      description: 'Governance, payments, matches, and mentions',
      icon: Bell,
      href: '/(tabs)/notifications',
    },
    {
      label: 'Commons Marketplace',
      description: 'Member stores and shared offers',
      icon: Store,
      href: '/(tabs)/store',
    },
    {
      label: 'Governance Proposals',
      description: 'Votes, drafts, and member decisions',
      icon: Vote,
      href: '/(tabs)/proposals',
    },
    {
      label: 'Privacy & Security',
      description: 'Account protection and wallet backup',
      icon: Shield,
      href: '/export-wallet',
    },
    {
      label: 'Help & Support',
      description: 'Get help with your Cahootz account',
      icon: HelpCircle,
    },
    {
      label: isDeletingAccount ? 'Deleting Account...' : 'Delete Account',
      description: 'Deactivate this account',
      icon: Trash2,
      destructive: true,
      onPress: handleDeleteAccount,
    },
    {
      label: `Sign Out (@${handle})`,
      description: 'Leave this device signed out',
      icon: LogOut,
      destructive: true,
      onPress: () => void handleLogout(),
    },
  ];

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: PROFILE_THEME.paper }}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="border-b bg-white px-3 pt-3 pb-2" style={{ borderColor: PROFILE_THEME.border }}>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={handleBack}
              className="h-9 w-9 items-center justify-center rounded-full border bg-white"
              style={{ borderColor: PROFILE_THEME.border }}
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={18} color="#1F2937" strokeWidth={2.6} />
            </TouchableOpacity>
            <View className="min-w-0 flex-1">
              <Text className="text-[10px] font-black uppercase text-gray-500">You</Text>
              <Text className="text-base font-black text-gray-950" numberOfLines={1}>
                {commonsName}
              </Text>
            </View>
            <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: PROFILE_THEME.primary }}>
              <UserCircle size={17} color="#FFFFFF" />
            </View>
          </View>
        </View>

        <View className="px-5 py-4">
          <View className="rounded-2xl border bg-white p-5" style={{ borderColor: PROFILE_THEME.border }}>
            <View className="flex-row items-center gap-4">
              <View className="h-16 w-16 items-center justify-center rounded-2xl" style={{ backgroundColor: PROFILE_THEME.primarySoft }}>
                <Text className="text-2xl font-black" style={{ color: PROFILE_THEME.primary }}>
                  {displayName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xl font-black text-gray-950" numberOfLines={1}>
                  {displayName}
                </Text>
                <Text className="mt-0.5 text-sm font-semibold text-gray-500" numberOfLines={1}>
                  @{handle} · {roleLabel}
                </Text>
                <View className="mt-2 self-start rounded-full px-3 py-1" style={{ backgroundColor: '#DCFCE7' }}>
                  <Text className="text-xs font-black capitalize" style={{ color: PROFILE_THEME.success }}>
                    {statusLabel}
                  </Text>
                </View>
              </View>
            </View>

            {user?.walletAddress ? (
              <TouchableOpacity
                onPress={handleCopyAddress}
                className="mt-4 flex-row items-center justify-between rounded-xl border bg-gray-50 p-3"
                style={{ borderColor: PROFILE_THEME.border }}
                activeOpacity={0.75}
              >
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-black uppercase text-gray-500">Wallet Address</Text>
                  <Text className="mt-1 font-mono text-sm text-gray-800">{shortenAddress(user.walletAddress)}</Text>
                </View>
                {copiedAddress ? <Check size={18} color={PROFILE_THEME.success} /> : <Copy size={18} color={PROFILE_THEME.muted} />}
              </TouchableOpacity>
            ) : null}
          </View>

          <View className="mt-4 flex-row gap-3">
            <View className="flex-1 rounded-2xl border bg-white p-4" style={{ borderColor: PROFILE_THEME.border }}>
              <View className="mb-3 h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: PROFILE_THEME.primarySoft }}>
                <CircleEllipsis size={20} color={PROFILE_THEME.primary} />
              </View>
              <Text className="text-xs font-black uppercase text-gray-500">Your Commons</Text>
              <Text className="mt-1 text-base font-black text-gray-950" numberOfLines={1}>
                {commonsName}
              </Text>
            </View>
            <View className="flex-1 rounded-2xl border bg-white p-4" style={{ borderColor: PROFILE_THEME.border }}>
              <View className="mb-3 h-10 w-10 items-center justify-center rounded-xl bg-green-50">
                <Check size={20} color={PROFILE_THEME.success} />
              </View>
              <Text className="text-xs font-black uppercase text-gray-500">Membership</Text>
              <Text className="mt-1 text-base font-black text-gray-950 capitalize">{statusLabel}</Text>
            </View>
          </View>

          <View className="mt-4 overflow-hidden rounded-2xl border bg-white" style={{ borderColor: PROFILE_THEME.border }}>
            <Text className="px-4 pb-2 pt-4 text-xs font-black uppercase text-gray-500">Navigation</Text>
            {navItems.map((item, index) => {
              const Icon = item.icon;
              const isLast = index === navItems.length - 1;
              const tint = item.destructive ? '#DC2626' : PROFILE_THEME.primary;

              return (
                <TouchableOpacity
                  key={item.label}
                  onPress={item.onPress || (() => item.href && router.push(item.href as any))}
                  disabled={isDeletingAccount && item.label.startsWith('Deleting')}
                  className="flex-row items-center gap-3 px-4 py-4"
                  style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: PROFILE_THEME.border }}
                  activeOpacity={0.75}
                >
                  <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: item.destructive ? '#FEF2F2' : PROFILE_THEME.primarySoft }}>
                    {isDeletingAccount && item.label.startsWith('Deleting') ? (
                      <ActivityIndicator size="small" color={tint} />
                    ) : (
                      <Icon size={20} color={tint} />
                    )}
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className={`font-black ${item.destructive ? 'text-red-700' : 'text-gray-950'}`}>{item.label}</Text>
                    <Text className={`mt-0.5 text-xs font-semibold ${item.destructive ? 'text-red-500' : 'text-gray-500'}`}>
                      {item.description}
                    </Text>
                  </View>
                  {!item.onPress ? <ChevronRight size={18} color="#CBD5E1" /> : null}
                </TouchableOpacity>
              );
            })}
          </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
