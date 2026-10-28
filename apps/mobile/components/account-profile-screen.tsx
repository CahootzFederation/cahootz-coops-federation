import { DESIGN } from '@/constants/design';
import React from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Award,
  Bell,
  Check,
  ChevronRight,
  CircleEllipsis,
  Copy,
  HelpCircle,
  LogOut,
  Pencil,
  QrCode,
  ReceiptText,
  RotateCcw,
  Settings,
  Shield,
  Sparkles,
  Store,
  Trash2,
  UserCircle,
  Vote,
  Wallet,
} from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { useCoin } from '@/contexts/platform-config-context';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { canAccessUpdateChannelDebug } from '@/lib/update-channel-debug';

const PROFILE_THEME = {
  paper: DESIGN.paper,
  primary: DESIGN.primary,
  primarySoft: DESIGN.primarySoft,
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
  const { user, login, logout, resetProfileOnboarding } = useAuth();
  const coin = useCoin();
  const [copiedAddress, setCopiedAddress] = React.useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = React.useState(false);
  const [fundingBadges, setFundingBadges] = React.useState<any[]>([]);
  const [isEditingIdentity, setIsEditingIdentity] = React.useState(false);
  const [isSavingIdentity, setIsSavingIdentity] = React.useState(false);
  const [identityError, setIdentityError] = React.useState('');
  const [nameDraft, setNameDraft] = React.useState('');
  const [nicknameDraft, setNicknameDraft] = React.useState('');
  const [handleDraft, setHandleDraft] = React.useState('');

  React.useEffect(() => {
    if (!user?.walletAddress) return;
    api.getMyFundingBadgeHistory(user.walletAddress)
      .then(setFundingBadges)
      .catch(() => setFundingBadges([]));
  }, [user?.walletAddress]);

  const displayName = user?.nickname?.trim() || user?.name?.trim() || user?.email?.split('@')[0] || 'Member';
  const handle = user?.handle || user?.email?.split('@')[0]?.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'member';
  const commonsName = user?.coop?.name?.trim() || 'Your commons';
  const roleLabel = user?.roles?.join(', ') || 'Member';
  const statusLabel = user?.status?.toLowerCase() || 'active';
  const canUseUpdateDebug = canAccessUpdateChannelDebug(user?.email);

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
      Alert.alert("Couldn't sign you out", 'Try again.');
    }
  };

  const handleResetOnboarding = async () => {
    try {
      await resetProfileOnboarding();
    } catch (error) {
      console.error('Reset onboarding error:', error);
      Alert.alert('Could not reset onboarding', 'Please try again.');
    }
  };

  const performDeleteAccount = async () => {
    if (!user) {
      Alert.alert('Sign in first', 'Sign in to delete your account.');
      return;
    }

    if (!user.walletAddress) {
      Alert.alert("Your account isn't set up yet", 'We need to finish setting up your account before we can delete it. Try again in a minute.');
      return;
    }

    setIsDeletingAccount(true);
    try {
      const result = await api.deleteAccount(user.id, user.walletAddress);
      if (result.isDemoMode) {
        await logout();
        return;
      }

      Alert.alert('Account deleted', result.message || 'Your account has been deleted.', [
        { text: 'OK', onPress: () => void logout() },
      ]);
    } catch (error) {
      console.error('Delete account error:', error);
      Alert.alert("Couldn't delete your account", friendlyError(error, "We couldn't delete your account."));
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleDeleteAccount = () => {
    if (isDeletingAccount) return;

    Alert.alert('Delete your account?', 'This will deactivate your Cahootz account and sign you out.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete account', style: 'destructive', onPress: () => void performDeleteAccount() },
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

  const openIdentityEditor = () => {
    setNameDraft(user?.name || '');
    setNicknameDraft(user?.nickname || '');
    setHandleDraft(handle);
    setIdentityError('');
    setIsEditingIdentity(true);
  };

  const saveIdentity = async () => {
    if (!user || isSavingIdentity) return;
    setIsSavingIdentity(true);
    setIdentityError('');
    try {
      const saved = await api.updateIdentity(
        { name: nameDraft.trim(), nickname: nicknameDraft.trim() || null, handle: handleDraft.trim().toLowerCase() },
        user.sessionToken,
      );
      await login({ ...user, ...saved });
      setIsEditingIdentity(false);
    } catch (error) {
      setIdentityError(friendlyError(error, "We couldn't save your profile."));
    } finally {
      setIsSavingIdentity(false);
    }
  };

  const navItems: NavItem[] = [
    {
      label: 'Personal page',
      description: 'Posts, drafts, offers, projects, and saved thoughts',
      icon: UserCircle,
      href: '/(authenticated)/personal-page',
    },
    // No global "Private Spaces" entry here on purpose — Circles live under
    // a commons now (see the Circles section on /commons/[coopId]); a
    // standalone profile-menu link made it look like they existed outside one.
    {
      label: 'Wallet',
      description: `${coin.name} balance, wallet address, and saved cards`,
      icon: Wallet,
      href: '/(authenticated)/payment-methods',
    },
    {
      label: 'Pay a store',
      description: "Scan a store's QR code or type in its store code",
      icon: QrCode,
      href: '/(authenticated)/scan-pay',
    },
    {
      label: 'Your payments',
      description: 'Payments you made or received, with receipts',
      icon: ReceiptText,
      href: '/(authenticated)/history',
    },
    {
      label: 'Alerts',
      description: 'Updates from your account activity',
      icon: Bell,
      href: '/(tabs)/notifications',
    },
    {
      label: 'Notification settings',
      description: 'Choose push notifications and categories',
      icon: Settings,
      href: '/(authenticated)/notification-settings',
    },
    {
      label: 'Sage settings',
      description: "See how Sage decides what to do",
      icon: Sparkles,
      href: '/(authenticated)/sage-settings',
    },
    {
      label: 'Community board',
      description: 'Board posts and links to real Commons tools',
      icon: Store,
      href: '/(tabs)/board',
    },
    {
      label: 'Proposals and votes',
      description: 'Votes, drafts, and member decisions',
      icon: Vote,
      href: '/(tabs)/proposals',
    },
    {
      label: 'Privacy and security',
      description: 'Account protection and wallet backup',
      icon: Shield,
      href: '/export-wallet',
    },
    ...(canUseUpdateDebug
      ? [
          {
            label: 'Update Channels',
            description: 'Switch EAS update channels for testing',
            icon: Settings,
            href: '/(authenticated)/debug-updates',
          },
        ]
      : []),
    ...(__DEV__
      ? [
          {
            label: 'Reset Onboarding (Dev)',
            description: 'Force the welcome screen to show again on this device',
            icon: RotateCcw,
            onPress: () => void handleResetOnboarding(),
          },
        ]
      : []),
    {
      label: 'Help and support',
      description: 'Get help with your Cahootz account',
      icon: HelpCircle,
    },
    {
      label: isDeletingAccount ? 'Deleting account…' : 'Delete account',
      description: 'Deactivate this account',
      icon: Trash2,
      destructive: true,
      onPress: handleDeleteAccount,
    },
    {
      label: `Sign out (@${handle})`,
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
                {user?.nickname && user?.name ? (
                  <Text className="mt-0.5 text-xs font-semibold text-gray-500" numberOfLines={1}>{user.name}</Text>
                ) : null}
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

            {user?.email ? (
              <View className="mt-4 rounded-xl border bg-gray-50 p-3" style={{ borderColor: PROFILE_THEME.border }}>
                <Text className="text-xs font-black uppercase text-gray-500">Email</Text>
                <Text className="mt-1 text-sm text-gray-800" numberOfLines={1}>{user.email}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              onPress={openIdentityEditor}
              className="mt-4 flex-row items-center justify-center gap-2 rounded-xl py-3"
              style={{ backgroundColor: PROFILE_THEME.primarySoft }}
              accessibilityRole="button"
              accessibilityLabel="Edit name, nickname, and @"
            >
              <Pencil size={15} color={PROFILE_THEME.primary} />
              <Text className="font-black" style={{ color: PROFILE_THEME.primary }}>Edit name, nickname, and @</Text>
            </TouchableOpacity>

            {user?.walletAddress ? (
              <TouchableOpacity
                onPress={handleCopyAddress}
                className="mt-4 flex-row items-center justify-between rounded-xl border bg-gray-50 p-3"
                style={{ borderColor: PROFILE_THEME.border }}
                activeOpacity={0.75}
              >
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-black uppercase text-gray-500">Wallet address</Text>
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
              <Text className="text-xs font-black uppercase text-gray-500">Your commons</Text>
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

          {fundingBadges.length > 0 ? (
            <View className="mt-4 rounded-2xl border bg-white p-4" style={{ borderColor: PROFILE_THEME.border }}>
              <View className="flex-row items-center">
                <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: '#FFF7ED' }}>
                  <Award size={20} color={PROFILE_THEME.primary} />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="font-black text-gray-950">Commons supporter badges</Text>
                  <Text className="mt-0.5 text-xs font-semibold text-gray-500">Your verified funding history</Text>
                </View>
              </View>
              <View className="mt-3 gap-2">
                {fundingBadges.map((badge) => (
                  <View key={badge.id} className="flex-row items-center rounded-xl border p-3" style={{ borderColor: PROFILE_THEME.border }}>
                    <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: `${badge.definition.color}18`, borderColor: badge.definition.color, borderWidth: 2 }}>
                      <Award size={16} color={badge.definition.color} />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-sm font-black text-gray-950">{badge.definition.name}</Text>
                      <Text className="mt-0.5 text-xs font-semibold text-gray-500">{badge.commonsName}</Text>
                    </View>
                    <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: badge.status === 'ACTIVE' ? '#DCFCE7' : '#F1F5F9' }}>
                      <Text className="text-[10px] font-black uppercase" style={{ color: badge.status === 'ACTIVE' ? '#166534' : '#64748B' }}>{badge.status}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

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
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityHint={item.description}
                  className="flex-row items-center gap-3 px-4 py-4"
                  style={{ minHeight: 56, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: PROFILE_THEME.border }}
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

      <Modal visible={isEditingIdentity} transparent animationType="slide" onRequestClose={() => setIsEditingIdentity(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-3xl bg-white px-5 pb-8 pt-5">
            <Text className="text-xl font-black text-gray-950">Edit your identity</Text>
            <Text className="mt-1 text-sm text-gray-500">Your @ is public and must be unique.</Text>

            <Text className="mb-1 mt-5 text-xs font-black uppercase text-gray-500">Name</Text>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              maxLength={100}
              autoCapitalize="words"
              accessibilityLabel="Name"
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-base text-gray-950"
            />

            <Text className="mb-1 mt-4 text-xs font-black uppercase text-gray-500">Nickname (optional)</Text>
            <TextInput
              value={nicknameDraft}
              onChangeText={setNicknameDraft}
              maxLength={60}
              accessibilityLabel="Nickname"
              className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-base text-gray-950"
            />

            <Text className="mb-1 mt-4 text-xs font-black uppercase text-gray-500">Your @</Text>
            <View className="flex-row items-center rounded-xl border border-gray-200 bg-gray-50 px-3">
              <Text className="text-base font-black text-gray-500">@</Text>
              <TextInput
                value={handleDraft}
                onChangeText={(value) => setHandleDraft(value.toLowerCase())}
                maxLength={30}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Handle"
                className="flex-1 py-3 pl-1 text-base text-gray-950"
              />
            </View>
            <Text className="mt-1 text-xs text-gray-500">3–30 lowercase letters, numbers, underscores, or hyphens.</Text>

            {identityError ? <Text className="mt-3 font-semibold text-red-600">{identityError}</Text> : null}

            <View className="mt-5 flex-row gap-3">
              <TouchableOpacity
                onPress={() => setIsEditingIdentity(false)}
                disabled={isSavingIdentity}
                className="flex-1 rounded-xl border border-gray-200 py-3"
                accessibilityRole="button"
                accessibilityLabel="Cancel editing identity"
              >
                <Text className="text-center font-black text-gray-700">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void saveIdentity()}
                disabled={isSavingIdentity}
                className="flex-1 flex-row items-center justify-center rounded-xl py-3"
                style={{ backgroundColor: PROFILE_THEME.primary, opacity: isSavingIdentity ? 0.65 : 1 }}
                accessibilityRole="button"
                accessibilityLabel="Save identity"
              >
                {isSavingIdentity ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                <Text className="ml-2 font-black text-white">{isSavingIdentity ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
