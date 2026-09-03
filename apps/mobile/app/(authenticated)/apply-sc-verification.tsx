import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, BadgeCheck, Clock, ShieldCheck, XCircle, Info, TrendingDown, TrendingUp, CheckSquare, Square, AlertTriangle } from 'lucide-react-native';
import { useAuth } from '@/contexts/auth-context';
import { useCoin } from '@/contexts/platform-config-context';
import { api } from '@/lib/api';

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(1) + '%';
}

export default function ApplyScVerificationScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const { user } = useAuth();
  const coin = useCoin();
  const [status, setStatus] = useState<any>(null);
  const [feeConfig, setFeeConfig] = useState<{
    platformMarkupBps: number;
    treasuryFeeBps: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [whyScEligible, setWhyScEligible] = useState('');
  const [agreedToFees, setAgreedToFees] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.walletAddress || !storeId) return;
    const [result, fees] = await Promise.all([
      api.getMyScVerificationStatus(String(storeId), user.walletAddress),
      api.getActiveFeeConfig(user.walletAddress).catch(() => null),
    ]);
    setStatus(result);
    if (fees) setFeeConfig(fees);
    if (result?.application) {
      setWhyScEligible(result.application.whyScEligible || '');
    }
  }, [storeId, user?.walletAddress]);

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        await loadData();
      } catch (error: any) {
        Alert.alert('Error', error.message || `Failed to load ${coin.symbol} rewards status`);
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, [loadData]);

  const handleSubmit = async () => {
    if (!user?.walletAddress || !storeId) {
      Alert.alert('Error', 'Missing required information. Please go back and try again.');
      return;
    }

    if (!agreedToFees) {
      Alert.alert('Agreement Required', 'Please confirm you understand and agree to the platform fee structure before submitting.');
      return;
    }

    if (whyScEligible.trim().length < 50) {
      Alert.alert('More Detail Needed', `Please explain why your store should earn ${coin.symbol} rewards in at least 50 characters.`);
      return;
    }

    try {
      setSubmitting(true);
      await api.submitScVerificationApplication({
        storeId,
        whyScEligible: whyScEligible.trim(),
      }, user.walletAddress);

      await loadData();
      Alert.alert('Application Submitted', `Your ${coin.symbol} rewards application is now pending admin review.`);
    } catch (error: any) {
      Alert.alert('Submission Failed', error.message || `Failed to submit ${coin.symbol} rewards application`);
    } finally {
      setSubmitting(false);
    }
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

  const applicationStatus = status?.application?.status || status?.scApplicationStatus || 'NOT_APPLIED';
  const stripeReady = status?.stripeReady === true;

  const platformMarkupPct = feeConfig ? bpsToPercent(feeConfig.platformMarkupBps) : '4.0%';
  const treasuryFeePct = feeConfig ? bpsToPercent(feeConfig.treasuryFeeBps) : '4.0%';
  const examplePrice = 100;
  const platformFee = feeConfig ? (examplePrice * feeConfig.platformMarkupBps) / 10000 : 4;
  const treasuryFee = feeConfig ? (examplePrice * feeConfig.treasuryFeeBps) / 10000 : 4;
  const customerPays = examplePrice + platformFee;
  const merchantReceives = examplePrice - treasuryFee;

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900" edges={['top']}>
      <View className="flex-row items-center justify-between px-5 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <TouchableOpacity onPress={() => router.back()}>
          <ArrowLeft size={24} color="#374151" />
        </TouchableOpacity>
        <Text className="text-lg font-semibold text-gray-900 dark:text-white">Earn {coin.symbol} Rewards</Text>
        <View className="w-6" />
      </View>

      <ScrollView className="flex-1 px-5 py-5" showsVerticalScrollIndicator={false}>

        {/* What this means */}
        <View className="bg-white dark:bg-gray-800 rounded-2xl p-5 mb-4">
          <View className="flex-row items-center mb-3">
            <ShieldCheck size={18} color="#FF6B00" />
            <Text className="text-gray-900 dark:text-white font-semibold ml-2">Apply to earn {coin.symbol} rewards</Text>
          </View>
          <Text className="text-gray-600 dark:text-gray-300 leading-6">
            {coin.name} ({coin.symbol}) is a non-transferable membership token. Once your store is verified, every qualifying purchase earns customers {coin.symbol} tokens that reflect their commons participation and give them a voice in governance.
          </Text>
        </View>

        {/* Fee explanation */}
        <View className="bg-white dark:bg-gray-800 rounded-2xl p-5 mb-4">
          <View className="flex-row items-center mb-3">
            <Info size={18} color="#FF6B00" />
            <Text className="text-gray-900 dark:text-white font-semibold ml-2">How transaction fees work</Text>
          </View>
          <Text className="text-gray-500 dark:text-gray-400 text-sm leading-5 mb-4">
            Every sale through the platform has two fee layers that fund the commons:
          </Text>

          {/* Platform markup */}
          <View className="flex-row items-start mb-4">
            <View className="w-8 h-8 rounded-full bg-secondary dark:bg-amber-900/30 items-center justify-center mr-3 mt-0.5">
              <TrendingUp size={14} color="#FF6B00" />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center justify-between">
                <Text className="text-gray-900 dark:text-white font-medium">Platform markup</Text>
                <Text className="text-primary dark:text-amber-400 font-bold">{platformMarkupPct}</Text>
              </View>
              <Text className="text-gray-500 dark:text-gray-400 text-xs mt-1 leading-4">
                Added on top of your listed price. The customer pays this. It covers platform operating costs and keeps the network running.
              </Text>
            </View>
          </View>

          {/* Treasury fee */}
          <View className="flex-row items-start mb-4">
            <View className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 items-center justify-center mr-3 mt-0.5">
              <TrendingDown size={14} color="#16A34A" />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center justify-between">
                <Text className="text-gray-900 dark:text-white font-medium">Community treasury fee</Text>
                <Text className="text-green-600 dark:text-green-400 font-bold">{treasuryFeePct}</Text>
              </View>
              <Text className="text-gray-500 dark:text-gray-400 text-xs mt-1 leading-4">
                Deducted from what you receive. Goes directly to the commons Wealth Fund — a shared pool that reinvests in the community.
              </Text>
            </View>
          </View>

          {/* Example breakdown */}
          <View className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4">
            <Text className="text-gray-500 dark:text-gray-400 text-xs font-semibold uppercase mb-3">
              Example: $100 sale
            </Text>
            <View className="flex-row justify-between mb-1">
              <Text className="text-gray-600 dark:text-gray-300 text-sm">Your listed price</Text>
              <Text className="text-gray-900 dark:text-white text-sm font-medium">${examplePrice.toFixed(2)}</Text>
            </View>
            <View className="flex-row justify-between mb-1">
              <Text className="text-gray-600 dark:text-gray-300 text-sm">+ Platform markup ({platformMarkupPct})</Text>
              <Text className="text-primary dark:text-amber-400 text-sm">+${platformFee.toFixed(2)}</Text>
            </View>
            <View className="border-t border-gray-200 dark:border-gray-600 my-2" />
            <View className="flex-row justify-between mb-1">
              <Text className="text-gray-900 dark:text-white text-sm font-semibold">Customer pays</Text>
              <Text className="text-gray-900 dark:text-white text-sm font-bold">${customerPays.toFixed(2)}</Text>
            </View>
            <View className="flex-row justify-between mt-2">
              <Text className="text-gray-600 dark:text-gray-300 text-sm">− Community treasury ({treasuryFeePct})</Text>
              <Text className="text-green-600 dark:text-green-400 text-sm">−${treasuryFee.toFixed(2)}</Text>
            </View>
            <View className="border-t border-gray-200 dark:border-gray-600 my-2" />
            <View className="flex-row justify-between">
              <Text className="text-gray-900 dark:text-white text-sm font-semibold">You receive</Text>
              <Text className="text-gray-900 dark:text-white text-sm font-bold">${merchantReceives.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* Stripe Connect gate — must be payment-approved before applying */}
        {status && !stripeReady && applicationStatus !== 'APPROVED' && (
          <View className="bg-secondary dark:bg-amber-900/20 rounded-2xl p-4 mb-4 border border-border dark:border-amber-800">
            <View className="flex-row items-start">
              <AlertTriangle size={20} color="#FF6B00" />
              <View className="ml-3 flex-1">
                <Text className="text-primary dark:text-amber-300 font-semibold">Complete payment setup first</Text>
                <Text className="text-primary dark:text-amber-300 text-sm mt-1">
                  Your payment account must be approved before you can apply for {coin.symbol} rewards. Finish setting up payments in My Store.
                </Text>
                <TouchableOpacity
                  onPress={() => router.replace('/my-store')}
                  className="mt-3 bg-primary py-2 px-4 rounded-lg self-start"
                >
                  <Text className="text-white font-semibold text-sm">Go to My Store</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Application status banners */}
        {applicationStatus === 'APPROVED' && (
          <View className="bg-green-50 dark:bg-green-900/20 rounded-2xl p-4 mb-4">
            <View className="flex-row items-start">
              <BadgeCheck size={20} color="#16A34A" />
              <View className="ml-3 flex-1">
                <Text className="text-green-700 dark:text-green-300 font-semibold">{coin.symbol} rewards approved</Text>
                <Text className="text-green-700 dark:text-green-300 text-sm mt-1">
                  Your store is verified. Customers earn {coin.symbol} on qualifying purchases.
                </Text>
              </View>
            </View>
          </View>
        )}

        {applicationStatus === 'PENDING' && (
          <View className="bg-secondary dark:bg-amber-900/20 rounded-2xl p-4 mb-4">
            <View className="flex-row items-start">
              <Clock size={20} color="#FF6B00" />
              <View className="ml-3 flex-1">
                <Text className="text-primary dark:text-amber-300 font-semibold">Application under review</Text>
                <Text className="text-primary dark:text-amber-300 text-sm mt-1">
                  Admin review is still pending. You can come back later to check the status.
                </Text>
              </View>
            </View>
          </View>
        )}

        {applicationStatus === 'REJECTED' && (
          <View className="bg-red-50 dark:bg-red-900/20 rounded-2xl p-4 mb-4">
            <View className="flex-row items-start">
              <XCircle size={20} color="#DC2626" />
              <View className="ml-3 flex-1">
                <Text className="text-red-700 dark:text-red-300 font-semibold">Previous application was rejected</Text>
                <Text className="text-red-700 dark:text-red-300 text-sm mt-1">
                  {status?.application?.rejectionReason || 'You can update your application and submit again.'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Application form — only shown when Stripe is approved */}
        {stripeReady && applicationStatus !== 'APPROVED' && applicationStatus !== 'PENDING' && (
          <>
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Why should your store qualify for {coin.symbol} rewards?
              </Text>
              <TextInput
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white h-36"
                placeholder={`Explain how your store fits the commons mission, how customers benefit, and why it should participate in the ${coin.symbol} rewards network.`}
                placeholderTextColor="#9CA3AF"
                multiline
                textAlignVertical="top"
                value={whyScEligible}
                onChangeText={setWhyScEligible}
              />
              <Text className="text-xs text-gray-500 mt-1">{whyScEligible.length}/50 minimum characters</Text>
            </View>

            {/* Fee agreement checkbox */}
            <TouchableOpacity
              onPress={() => setAgreedToFees(!agreedToFees)}
              className={`flex-row items-start p-4 rounded-2xl mb-6 border ${
                agreedToFees
                  ? 'bg-secondary dark:bg-amber-900/20 border-amber-400 dark:border-amber-600'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
              }`}
              activeOpacity={0.7}
            >
              {agreedToFees ? (
                <CheckSquare size={22} color="#FF6B00" style={{ marginTop: 1 }} />
              ) : (
                <Square size={22} color="#9CA3AF" style={{ marginTop: 1 }} />
              )}
              <Text className="flex-1 ml-3 text-sm text-gray-700 dark:text-gray-300 leading-5">
                I understand that a <Text className="font-semibold text-primary dark:text-amber-400">{platformMarkupPct} platform markup</Text> is added to my listed prices (paid by customers), and a <Text className="font-semibold text-green-600 dark:text-green-400">{treasuryFeePct} community treasury fee</Text> is deducted from my payouts to fund the commons Wealth Fund.
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <View className="px-5 py-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        {applicationStatus === 'APPROVED' || applicationStatus === 'PENDING' ? (
          <TouchableOpacity onPress={() => router.replace('/my-store')} className="bg-primary py-4 rounded-xl">
            <Text className="text-center text-white font-bold">Back to My Store</Text>
          </TouchableOpacity>
        ) : !stripeReady ? (
          <TouchableOpacity onPress={() => router.replace('/my-store')} className="bg-primary py-4 rounded-xl">
            <Text className="text-center text-white font-bold">Set Up Payments First</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting || !agreedToFees}
            className={`py-4 rounded-xl ${submitting || !agreedToFees ? 'bg-gray-300 dark:bg-gray-700' : 'bg-primary'}`}
          >
            {submitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-center text-white font-bold">
                {applicationStatus === 'REJECTED' ? 'Resubmit Application' : `Apply for ${coin.symbol} Rewards`}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}
