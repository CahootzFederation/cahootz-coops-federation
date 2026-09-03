import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ArrowLeft,
  CreditCard,
  Plus,
  Check,
  Wallet,
  AlertCircle,
  CheckCircle,
} from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { calculateProcessorFee } from '@/lib/fee-calculator';
import { FeeBreakdown, CompactFeeDisplay } from '@/components/fee-breakdown';

const PRESET_AMOUNTS = [25, 50, 100, 250];

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expiryMonth: number;
  expiryYear: number;
  isDefault: boolean;
}

export default function FundWalletScreen() {
  const { user } = useAuth();
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [currentBalance, setCurrentBalance] = useState<number>(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successAmount, setSuccessAmount] = useState<number>(0);

  const getErrorMessage = (error: unknown): string => {
    if (!error) return 'Unable to add funds. Please try again.';
    if (typeof error === 'string') return error;

    if (error instanceof Error) {
      return error.message || 'Unable to add funds. Please try again.';
    }

    const maybeError = error as {
      message?: string;
      error?: { message?: string };
      data?: { message?: string };
    };
    return (
      maybeError?.message ||
      maybeError?.error?.message ||
      maybeError?.data?.message ||
      'Unable to add funds. Please try again.'
    );
  };

  const loadData = useCallback(async () => {
    if (!user?.id || !user?.walletAddress) return;

    try {
      // Load payment methods and balance in parallel
      const [methodsResult, balanceResult] = await Promise.all([
        api.getPaymentMethods(user.id, user.walletAddress),
        api.getTokenBalances(user.walletAddress),
      ]);

      setPaymentMethods(methodsResult?.methods || []);

      // Find default method
      const defaultMethod = methodsResult?.methods?.find((m: PaymentMethod) => m.isDefault);
      if (defaultMethod) {
        setSelectedMethodId(defaultMethod.id);
      } else if (methodsResult?.methods?.length > 0) {
        setSelectedMethodId(methodsResult.methods[0].id);
      }

      // Parse balance (UC = dollars, 1:1 peg)
      const balance = parseFloat(balanceResult?.uc || '0');
      setCurrentBalance(balance);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getEffectiveAmount = (): number => {
    if (amount) return amount;
    const parsed = parseFloat(customAmount);
    return isNaN(parsed) ? 0 : parsed;
  };

  const handlePresetAmount = (preset: number) => {
    setAmount(preset);
    setCustomAmount('');
  };

  const handleCustomAmountChange = (text: string) => {
    // Only allow numbers and one decimal point
    const cleaned = text.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    if (parts[1] && parts[1].length > 2) return;

    setCustomAmount(cleaned);
    setAmount(null);
  };

  const handleFundWallet = async () => {
    const fundAmount = getEffectiveAmount();
    setSubmitError(null);

    if (fundAmount < 10) {
      Alert.alert('Minimum Amount', 'The minimum amount is $10.');
      return;
    }

    if (fundAmount > 10000) {
      Alert.alert('Maximum Amount', 'The maximum amount is $10,000.');
      return;
    }

    if (!selectedMethodId) {
      Alert.alert('No Card Selected', 'Please select a payment method or add a new card.');
      return;
    }

    if (!user?.walletAddress) {
      Alert.alert('Error', 'Wallet not found. Please try again.');
      return;
    }

    setProcessing(true);

    try {
      await api.fundWithSavedCard(
        fundAmount,
        user.walletAddress,
        selectedMethodId
      );

      // Show success modal
      setSuccessAmount(fundAmount);
      setShowSuccessModal(true);
      
      // Reset amount fields
      setAmount(null);
      setCustomAmount('');
      
      // Reload balance in background
      loadData();
    } catch (error: any) {
      console.error('Fund wallet error:', error);
      const message = getErrorMessage(error);
      setSubmitError(message);
      Alert.alert(
        'Payment Failed',
        message
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleAddCard = () => {
    router.push('/payment-methods');
  };

  const getBrandIcon = (brand: string) => {
    return <CreditCard size={20} color="#6B7280" />;
  };

  const formatCardBrand = (brand: string) => {
    const brands: Record<string, string> = {
      visa: 'Visa',
      mastercard: 'Mastercard',
      amex: 'American Express',
      discover: 'Discover',
    };
    return brands[brand.toLowerCase()] || brand;
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#FF6B00" />
          <Text className="text-gray-500 dark:text-gray-400 mt-4">Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const effectiveAmount = getEffectiveAmount();
  const isValidAmount = effectiveAmount >= 10 && effectiveAmount <= 10000;
  const feeInfo = isValidAmount ? calculateProcessorFee(effectiveAmount, 'stripe') : null;

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <TouchableOpacity onPress={() => router.back()}>
          <ArrowLeft size={24} color="#374151" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-gray-900 dark:text-white ml-4">
          Add Money
        </Text>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Current Balance */}
        <View className="bg-white dark:bg-gray-800 mx-5 mt-5 rounded-xl p-5">
          <Text className="text-gray-500 dark:text-gray-400 text-sm mb-1">
            Wallet Balance
          </Text>
          <View className="flex-row items-center">
            <Wallet size={24} color="#FF6B00" />
            <Text className="text-2xl font-bold text-gray-900 dark:text-white ml-2">
              ${currentBalance.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Amount Selection */}
        <View className="px-5 mt-6">
          <Text className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Select Amount
          </Text>

          {/* Preset Amounts */}
          <View className="flex-row flex-wrap gap-3 mb-4">
            {PRESET_AMOUNTS.map((preset) => (
              <TouchableOpacity
                key={preset}
                onPress={() => handlePresetAmount(preset)}
                className={`flex-1 min-w-[45%] py-4 rounded-xl border-2 items-center ${
                  amount === preset
                    ? 'bg-secondary dark:bg-amber-900/30 border-amber-500'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                }`}
              >
                <Text
                  className={`text-xl font-bold ${
                    amount === preset
                      ? 'text-primary'
                      : 'text-gray-900 dark:text-white'
                  }`}
                >
                  ${preset}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom Amount */}
          <View className="bg-white dark:bg-gray-800 rounded-xl p-4 border-2 border-gray-200 dark:border-gray-700">
            <Text className="text-gray-500 dark:text-gray-400 text-sm mb-2">
              Custom Amount
            </Text>
            <View className="flex-row items-center">
              <Text className="text-2xl font-bold text-gray-900 dark:text-white mr-2">
                $
              </Text>
              <TextInput
                value={customAmount}
                onChangeText={handleCustomAmountChange}
                placeholder="Enter amount"
                placeholderTextColor="#9CA3AF"
                keyboardType="decimal-pad"
                className="flex-1 text-2xl font-bold text-gray-900 dark:text-white"
              />
            </View>
            <Text className="text-gray-400 dark:text-gray-500 text-xs mt-2">
              Min: $10 | Max: $10,000
            </Text>
          </View>
        </View>

        {/* Payment Method Selection */}
        <View className="px-5 mt-6">
          <Text className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Payment Method
          </Text>

          {paymentMethods.length === 0 ? (
            <TouchableOpacity
              onPress={handleAddCard}
              className="bg-white dark:bg-gray-800 rounded-xl p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 flex-row items-center justify-center"
            >
              <Plus size={20} color="#FF6B00" />
              <Text className="text-primary font-medium ml-2">
                Add a Card
              </Text>
            </TouchableOpacity>
          ) : (
            <View className="space-y-3">
              {paymentMethods.map((method) => (
                <TouchableOpacity
                  key={method.id}
                  onPress={() => setSelectedMethodId(method.id)}
                  className={`bg-white dark:bg-gray-800 rounded-xl p-4 flex-row items-center border-2 ${
                    selectedMethodId === method.id
                      ? 'border-amber-500'
                      : 'border-transparent'
                  }`}
                >
                  {getBrandIcon(method.brand)}
                  <View className="flex-1 ml-3">
                    <Text className="text-gray-900 dark:text-white font-medium">
                      {formatCardBrand(method.brand)} **** {method.last4}
                    </Text>
                    <Text className="text-gray-500 dark:text-gray-400 text-sm">
                      Expires {method.expiryMonth}/{method.expiryYear}
                    </Text>
                  </View>
                  {selectedMethodId === method.id && (
                    <View className="w-6 h-6 bg-primary rounded-full items-center justify-center">
                      <Check size={14} color="#FFFFFF" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                onPress={handleAddCard}
                className="bg-gray-100 dark:bg-gray-800 rounded-xl p-4 flex-row items-center justify-center mt-2"
              >
                <Plus size={18} color="#6B7280" />
                <Text className="text-gray-600 dark:text-gray-400 font-medium ml-2">
                  Add New Card
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Fee Breakdown */}
        {feeInfo && (
          <View className="px-5 mt-6">
            <FeeBreakdown
              subtotal={effectiveAmount}
              processorFee={feeInfo.processorFee}
              processor="Stripe"
              showDetails={true}
            />
          </View>
        )}

        {/* Info */}
        <View className="mx-5 mt-6 mb-8 flex-row items-start">
          <AlertCircle size={16} color="#9CA3AF" className="mt-0.5" />
          <Text className="text-gray-500 dark:text-gray-400 text-sm flex-1 ml-2">
            Funds are added to your wallet instantly after payment. Processing fees are charged by the payment network.
          </Text>
        </View>
      </ScrollView>

      {/* Bottom Action */}
      <View className="px-5 py-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        {feeInfo && (
          <View className="mb-3">
            <View className="flex-row justify-between items-center">
              <Text className="text-gray-600 dark:text-gray-400">Wallet Credit</Text>
              <Text className="text-gray-900 dark:text-white font-medium">
                ${effectiveAmount.toFixed(2)}
              </Text>
            </View>
            <CompactFeeDisplay processorFee={feeInfo.processorFee} processor="Stripe" />
            <View className="border-t border-gray-200 dark:border-gray-700 my-2" />
            <View className="flex-row justify-between items-center">
              <Text className="text-gray-900 dark:text-white font-bold">Total Card Charge</Text>
              <Text className="text-gray-900 dark:text-white font-bold text-lg">
                ${feeInfo.total.toFixed(2)}
              </Text>
            </View>
          </View>
        )}

        <TouchableOpacity
          onPress={handleFundWallet}
          disabled={!isValidAmount || !selectedMethodId || processing}
          className={`py-4 rounded-xl items-center ${
            isValidAmount && selectedMethodId && !processing
              ? 'bg-primary'
              : 'bg-gray-300 dark:bg-gray-700'
          }`}
        >
          {processing ? (
            <View className="flex-row items-center">
              <ActivityIndicator color="#FFFFFF" size="small" />
              <Text className="text-white font-bold text-lg ml-2">
                Processing...
              </Text>
            </View>
          ) : (
            <View>
              <Text className="text-white font-bold text-lg">
                {isValidAmount && feeInfo
                  ? `Pay $${feeInfo.total.toFixed(2)} to Add $${effectiveAmount.toFixed(2)}`
                  : 'Enter Amount'}
              </Text>
              {isValidAmount && feeInfo && (
                <Text className="text-white/80 text-xs mt-1 text-center">
                  Includes ${feeInfo.processorFee.toFixed(2)} processing fee
                </Text>
              )}
            </View>
          )}
        </TouchableOpacity>

        {submitError && (
          <View className="mt-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3">
            <Text className="text-red-700 dark:text-red-300 text-sm font-medium">
              {submitError}
            </Text>
          </View>
        )}
      </View>

      {/* Success Modal */}
      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowSuccessModal(false);
          router.back();
        }}
      >
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm">
            <View className="items-center mb-4">
              <View className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 items-center justify-center mb-3">
                <CheckCircle size={32} color="#16a34a" />
              </View>
              <Text className="text-xl font-bold text-gray-900 dark:text-white text-center">
                Funds Added!
              </Text>
            </View>
            <Text className="text-gray-600 dark:text-gray-400 text-center mb-6">
              ${successAmount.toFixed(2)} has been added to your wallet successfully.
            </Text>
            <TouchableOpacity
              onPress={() => {
                setShowSuccessModal(false);
                router.back();
              }}
              className="bg-green-600 py-3 rounded-xl items-center"
            >
              <Text className="text-white font-semibold">Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
