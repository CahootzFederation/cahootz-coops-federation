import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowLeft,
  CreditCard,
  ExternalLink,
  AlertTriangle,
  Clock,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  Copy,
  Globe,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/auth-context';
import { useCoin } from '@/contexts/platform-config-context';
import { api } from '@/lib/api';

// Maps internal statuses to plain-English user-facing state
function getStatusInfo(store: any): {
  label: string;
  description: string;
  color: 'green' | 'amber' | 'red' | 'gray';
  actionNeeded: boolean;
  actionLabel?: string;
} {
  const onboarding = store?.stripeAccount?.onboardingStatus;
  const charges = store?.stripeAccount?.chargesEnabled;
  const requirements: string[] = store?.stripeAccount?.requirementsCurrentlyDue ?? [];

  if (charges) {
    return {
      label: 'Approved — your store is live',
      description: 'You can now accept payments from customers.',
      color: 'green',
      actionNeeded: false,
    };
  }

  if (onboarding === 'SUBMITTED' || onboarding === 'PENDING') {
    return {
      label: 'Under review',
      description: 'Your information has been submitted. This usually takes a few minutes. Tap "Check My Status" to see if you\'ve been approved.',
      color: 'amber',
      actionNeeded: false,
    };
  }

  if (onboarding === 'RESTRICTED' || requirements.length > 0) {
    return {
      label: 'Action required',
      description: 'There are a few things you need to finish before your account can be approved. Tap below to complete the remaining steps — it only takes a minute.',
      color: 'red',
      actionNeeded: true,
      actionLabel: 'Finish Setup',
    };
  }

  if (onboarding === 'REJECTED') {
    return {
      label: 'Not approved',
      description: 'Your account was not approved. This can happen if some information couldn\'t be verified. Tap below to try again or contact support.',
      color: 'red',
      actionNeeded: true,
      actionLabel: 'Try Again',
    };
  }

  // Not started yet
  return {
    label: 'Payment setup not started',
    description: 'Set up takes about 5 minutes. You\'ll need your business info and a bank account for payouts.',
    color: 'gray',
    actionNeeded: true,
    actionLabel: 'Set Up Payments',
  };
}

const COLOR_MAP = {
  green: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    text: 'text-green-700 dark:text-green-300',
    icon: '#16A34A',
  },
  amber: {
    bg: 'bg-secondary dark:bg-amber-900/20',
    text: 'text-primary dark:text-amber-300',
    icon: '#FF6B00',
  },
  red: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-700 dark:text-red-300',
    icon: '#DC2626',
  },
  gray: {
    bg: 'bg-gray-100 dark:bg-gray-800',
    text: 'text-gray-600 dark:text-gray-300',
    icon: '#9CA3AF',
  },
};

export default function StripeOnboardingScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const { user } = useAuth();
  const coin = useCoin();
  const [store, setStore] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null);
  const [pendingBusinessId, setPendingBusinessId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [businessType, setBusinessType] = useState<'company' | 'individual'>('company');

  const loadStore = useCallback(async () => {
    if (!user?.walletAddress) return;
    if (storeId) {
      const stores = await api.getMyStores(user.walletAddress);
      const found = stores?.find((s: any) => s.id === storeId) ?? null;
      setStore(found);
    } else {
      const data = await api.getMyStore(user.walletAddress);
      setStore(data);
    }
  }, [user?.walletAddress, storeId]);

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        await loadStore();
      } catch (error: any) {
        Alert.alert('Error', error.message || 'Failed to load store');
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, [loadStore]);

  const syncStatus = useCallback(async (quiet = false, businessIdOverride?: string) => {
    const businessId = businessIdOverride || store?.businessId;
    if (!user?.walletAddress || !user?.id || !businessId) return;
    try {
      setSyncing(true);
      const status = await api.syncStripeBusinessStatus({
        userId: user.id,
        businessId,
      }, user.walletAddress);
      await loadStore();

      if (status.chargesEnabled) {
        if (!quiet) Alert.alert('You\'re approved!', 'Your store is now live and ready to accept payments.');
      } else if (status.onboardingStatus === 'REJECTED') {
        Alert.alert(
          'Account not approved',
          'Your Stripe account was not approved. This is usually due to verification issues. Tap "Try Again" to restart the process or contact support.',
        );
      } else if (status.requirementsCurrentlyDue?.length > 0 || status.onboardingStatus === 'RESTRICTED') {
        Alert.alert(
          'Action required',
          'Stripe needs a bit more information before your account can be activated. Tap "Finish Setup" to complete the remaining steps.',
        );
      } else if (!quiet) {
        Alert.alert('Still under review', 'Hang tight — this usually takes just a few minutes. Check back soon.');
      }
    } catch (error: any) {
      if (!quiet) Alert.alert('Error', error.message || 'Failed to check status');
    } finally {
      setSyncing(false);
    }
  }, [user, store?.businessId, loadStore]);

  const handleGetLink = async () => {
    if (!user?.walletAddress || !user?.id || !storeId) return;
    try {
      setStarting(true);
      const result = await api.createBusinessForStore({
        userId: user.id,
        storeId,
        email: user.email || '',
        businessType,
        country: 'US',
      }, user.walletAddress);
      setOnboardingUrl(result.onboardingUrl);
      setPendingBusinessId(result.businessId);
    } catch (error: any) {
      Alert.alert('Setup Error', error.message || 'Failed to generate setup link');
    } finally {
      setStarting(false);
    }
  };

  const handleOpenInApp = async () => {
    if (!onboardingUrl) return;
    await WebBrowser.openBrowserAsync(onboardingUrl);
    // Clear the URL so the UI resets to the status-driven state
    setOnboardingUrl(null);
    // Sync and surface any issues (not quiet — user needs to know if something is broken)
    await syncStatus(false, pendingBusinessId ?? undefined);
  };

  const handleOpenInBrowser = () => {
    if (!onboardingUrl) return;
    Linking.openURL(onboardingUrl);
  };

  const handleCopyLink = async () => {
    if (!onboardingUrl) return;
    await Clipboard.setStringAsync(onboardingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#FF6B00" />
        </View>
      </SafeAreaView>
    );
  }

  const stripeReady = !!store?.stripeAccount?.chargesEnabled;
  const statusInfo = getStatusInfo(store);
  const colors = COLOR_MAP[statusInfo.color];

  const StatusIcon = statusInfo.color === 'green'
    ? CheckCircle2
    : statusInfo.color === 'red'
      ? AlertTriangle
      : statusInfo.color === 'amber'
        ? Clock
        : CreditCard;

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <TouchableOpacity onPress={() => router.replace('/my-store')}>
          <ArrowLeft size={24} color="#374151" />
        </TouchableOpacity>
        <Text className="text-lg font-semibold text-gray-900 dark:text-white">Payment Setup</Text>
        <View className="w-6" />
      </View>

      <ScrollView className="flex-1 px-5 py-5" showsVerticalScrollIndicator={false}>
        {/* Intro card */}
        <View className="bg-white dark:bg-gray-800 rounded-2xl p-5 mb-4">
          <View className="w-14 h-14 rounded-2xl bg-secondary dark:bg-amber-900/30 items-center justify-center mb-4">
            <CreditCard size={28} color="#FF6B00" />
          </View>
          <Text className="text-xl font-bold text-gray-900 dark:text-white">
            {stripeReady ? 'Your store is live!' : 'Set up payments to open your store'}
          </Text>
          <Text className="text-gray-600 dark:text-gray-300 mt-2 leading-6">
            {stripeReady
              ? 'Customers can now purchase from your store. Payouts will be deposited to your bank account.'
              : 'To accept payments from customers, we need to verify your identity and set up direct deposits to your bank. This takes about 5 minutes.'}
          </Text>
        </View>

        {/* Status card */}
        <View className={`rounded-2xl p-4 mb-4 ${colors.bg}`}>
          <View className="flex-row items-start">
            <StatusIcon size={20} color={colors.icon} />
            <View className="flex-1 ml-3">
              <Text className={`font-semibold ${colors.text}`}>{statusInfo.label}</Text>
              <Text className={`text-sm mt-1 leading-5 ${colors.text}`}>{statusInfo.description}</Text>
            </View>
          </View>
        </View>

        {/* Restricted — extra help */}
        {store?.stripeAccount?.onboardingStatus === 'RESTRICTED' && (
          <View className="bg-white dark:bg-gray-800 rounded-2xl p-5 mb-4 border border-red-200 dark:border-red-800">
            <Text className="font-semibold text-gray-900 dark:text-white mb-2">What does &quot;Action required&quot; mean?</Text>
            <Text className="text-gray-600 dark:text-gray-300 leading-6 text-sm">
              Our payment provider needs a bit more information to verify your account. This is normal and usually just means confirming your identity or adding a bank account.
              {'\n\n'}
              Tap <Text className="font-semibold">&quot;Finish Setup&quot;</Text> and follow the steps. If you get stuck, contact support.
            </Text>
          </View>
        )}

        {/* Business type — only before any account is created and before URL is generated */}
        {!stripeReady && !onboardingUrl && !store?.stripeAccount && (
          <>
            <View className="bg-white dark:bg-gray-800 rounded-2xl p-5 mb-4">
              <Text className="font-semibold text-gray-900 dark:text-white mb-3">Account type</Text>
              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => setBusinessType('company')}
                  className={`flex-1 py-3 rounded-xl border-2 items-center ${
                    businessType === 'company'
                      ? 'border-amber-500 bg-secondary dark:bg-amber-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                  }`}
                >
                  <Text className={`font-semibold text-sm ${businessType === 'company' ? 'text-primary dark:text-amber-300' : 'text-gray-600 dark:text-gray-300'}`}>
                    Business
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setBusinessType('individual')}
                  className={`flex-1 py-3 rounded-xl border-2 items-center ${
                    businessType === 'individual'
                      ? 'border-amber-500 bg-secondary dark:bg-amber-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                  }`}
                >
                  <Text className={`font-semibold text-sm ${businessType === 'individual' ? 'text-primary dark:text-amber-300' : 'text-gray-600 dark:text-gray-300'}`}>
                    Individual
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View className="bg-white dark:bg-gray-800 rounded-2xl p-5 mb-4">
              <Text className="font-semibold text-gray-900 dark:text-white mb-3">What you&apos;ll need</Text>
              {[
                'Your name and address',
                businessType === 'company' ? 'EIN or last 4 of SSN' : 'Last 4 of your SSN',
                'A bank account for payouts',
              ].map((item) => (
                <View key={item} className="flex-row items-center mb-2">
                  <View className="w-2 h-2 rounded-full bg-primary mr-3" />
                  <Text className="text-gray-600 dark:text-gray-300 text-sm">{item}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* SC upsell after approval */}
        {stripeReady && (
          <View className="bg-white dark:bg-gray-800 rounded-2xl p-5 mb-4">
            <View className="flex-row items-center mb-3">
              <ShieldCheck size={18} color="#FF6B00" />
              <Text className="text-gray-900 dark:text-white font-semibold ml-2">Optional: Earn rewards on sales</Text>
            </View>
            <Text className="text-gray-600 dark:text-gray-300 leading-6 text-sm">
              Once approved, purchases at your store can earn customers {coin.symbol} rewards. Apply now or later from My Store.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Action buttons */}
      <View className="px-5 py-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 gap-3">
        {!stripeReady && !onboardingUrl && (
          /* Generate link button */
          <TouchableOpacity
            onPress={handleGetLink}
            disabled={starting}
            className="bg-primary py-4 rounded-xl flex-row items-center justify-center"
          >
            {starting ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Text className="text-white font-bold mr-2">
                  {statusInfo.actionLabel ?? 'Set Up Payments'}
                </Text>
                <ExternalLink size={18} color="white" />
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Link options — shown after URL is generated */}
        {!stripeReady && onboardingUrl && (
          <View className="gap-2">
            <Text className="text-xs text-gray-500 dark:text-gray-400 text-center mb-1">
              Open Stripe to complete your setup
            </Text>
            <TouchableOpacity
              onPress={handleOpenInApp}
              className="bg-primary py-4 rounded-xl flex-row items-center justify-center"
            >
              <ExternalLink size={18} color="white" />
              <Text className="text-white font-bold ml-2">Open in App</Text>
            </TouchableOpacity>
            <View className="flex-row gap-2">
              <TouchableOpacity
                onPress={handleOpenInBrowser}
                className="flex-1 bg-gray-100 dark:bg-gray-700 py-3 rounded-xl flex-row items-center justify-center"
              >
                <Globe size={16} color="#FF6B00" />
                <Text className="text-gray-900 dark:text-white font-semibold ml-2 text-sm">Open in Browser</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCopyLink}
                className="flex-1 bg-gray-100 dark:bg-gray-700 py-3 rounded-xl flex-row items-center justify-center"
              >
                <Copy size={16} color={copied ? '#16A34A' : '#FF6B00'} />
                <Text className={`font-semibold ml-2 text-sm ${copied ? 'text-green-600' : 'text-gray-900 dark:text-white'}`}>
                  {copied ? 'Copied!' : 'Copy Link'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Check status — shown whenever there's a business to check */}
        {!stripeReady && (store?.businessId || pendingBusinessId) && (
          <TouchableOpacity
            onPress={() => syncStatus(false, pendingBusinessId ?? undefined)}
            disabled={syncing}
            className="bg-gray-100 dark:bg-gray-700 py-4 rounded-xl flex-row items-center justify-center"
          >
            {syncing ? (
              <ActivityIndicator color="#FF6B00" />
            ) : (
              <>
                <RefreshCw size={16} color="#FF6B00" />
                <Text className="text-center text-gray-900 dark:text-white font-semibold ml-2">Check My Status</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Navigation */}
        {stripeReady ? (
          <>
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/apply-sc-verification', params: { storeId: store.id } })}
              className="bg-primary py-4 rounded-xl"
            >
              <Text className="text-center text-white font-bold">Apply for {coin.symbol} Rewards</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.replace('/my-store')}
              className="py-3"
            >
              <Text className="text-center text-primary dark:text-amber-400 font-semibold">Go to My Store</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            onPress={() => router.replace('/my-store')}
            className="bg-gray-100 dark:bg-gray-700 py-4 rounded-xl"
          >
            <Text className="text-center text-gray-700 dark:text-gray-300 font-semibold">
              Save &amp; Come Back Later
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}
