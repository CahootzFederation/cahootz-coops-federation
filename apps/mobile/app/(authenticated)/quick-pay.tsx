import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useState, useEffect } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Store,
  CheckCircle,
  AlertCircle,
  Shield,
  Clock,
} from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { authenticateForPayment } from '@/lib/biometric';

interface StoreInfo {
  id: string;
  name: string;
  shortCode: string | null;
  imageUrl: string | null;
  isScVerified: boolean;
  acceptsQuickPay?: boolean;
}

interface PaymentRequestInfo {
  id: string;
  store: StoreInfo;
  amount: number | null;
  description: string | null;
  status: string;
  expiresAt: string | null;
  isExpired: boolean;
}

export default function QuickPayScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ token?: string; code?: string }>();

  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Payment request (from QR/link)
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequestInfo | null>(null);

  // Store (from code)
  const [store, setStore] = useState<StoreInfo | null>(null);

  // Amount (user-entered if not pre-set)
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  // Balance
  const [balance, setBalance] = useState<number>(0);
  const [balanceFormatted, setBalanceFormatted] = useState('$0.00');

  // Modals
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (params.token) {
      loadPaymentRequest(params.token);
    } else if (params.code) {
      loadStoreByCode(params.code);
    } else {
      setError('Invalid payment link');
      setLoading(false);
    }

    loadBalance();
  }, [params.token, params.code]);

  const loadBalance = async () => {
    if (!user?.id) return;

    try {
      const result = await api.getUSDBalance(user.id, user.walletAddress);
      setBalance(result.balance);
      setBalanceFormatted(result.formatted);
    } catch (err) {
      console.error('Error loading balance:', err);
    }
  };

  const loadPaymentRequest = async (token: string) => {
    try {
      setLoading(true);
      const result = await api.getPaymentRequest(token);

      if (!result.found) {
        setError('Payment request not found');
        return;
      }

      if (result.isExpired) {
        setError('This payment request has expired');
        return;
      }

      if (result.status !== 'PENDING') {
        setError(
          result.status === 'COMPLETED'
            ? 'This payment has already been completed'
            : 'This payment request is no longer valid'
        );
        return;
      }

      setPaymentRequest({
        id: result.id!,
        store: result.store!,
        amount: result.amount || null,
        description: result.description || null,
        status: result.status!,
        expiresAt: result.expiresAt || null,
        isExpired: result.isExpired!,
      });

      if (result.amount) {
        setAmount(result.amount.toString());
      }
    } catch (err) {
      console.error('Error loading payment request:', err);
      setError('Failed to load payment request');
    } finally {
      setLoading(false);
    }
  };

  const loadStoreByCode = async (code: string) => {
    try {
      setLoading(true);
      const result = await api.getStoreByCode(code);

      if (!result.found) {
        setError('Store not found');
        return;
      }

      setStore(result.store!);
    } catch (err) {
      console.error('Error loading store:', err);
      setError('Failed to load store');
    } finally {
      setLoading(false);
    }
  };

  const handleAmountChange = (text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    if (parts[1]?.length > 2) return;
    setAmount(cleaned);
  };

  const canPay = () => {
    const amountNum = parseFloat(amount);
    return amountNum > 0 && amountNum <= 10000;
  };

  const handlePay = async () => {
    if (!user?.walletAddress || !canPay()) return;

    const amountNum = parseFloat(amount);

    // Biometric authentication
    const authResult = await authenticateForPayment(`$${amountNum.toFixed(2)}`);
    if (!authResult.success) {
      if (authResult.error) {
        setErrorMessage(authResult.error);
        setShowErrorModal(true);
      }
      return;
    }

    setPaying(true);

    try {
      let result;

      if (paymentRequest) {
        // Pay via payment request
        result = await api.payRequest(params.token!, amountNum, user.walletAddress);
      } else if (store) {
        // Pay via store code
        result = await api.payByStoreCode(
          store.shortCode!,
          amountNum,
          note || undefined,
          user.walletAddress
        );
      } else {
        throw new Error('No payment target');
      }

      if (result.success) {
        const storeName = paymentRequest?.store.name || store?.name;
        setSuccessMessage(`Paid $${amountNum.toFixed(2)} to ${storeName}`);
        setShowSuccessModal(true);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Payment failed';
      setErrorMessage(errMsg);
      setShowErrorModal(true);
    } finally {
      setPaying(false);
    }
  };

  const currentStore = paymentRequest?.store || store;

  if (loading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#FF8A2A" />
        <Text className="text-gray-500 mt-4">Loading payment info...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View className="flex-1 bg-white">
          <View className="pt-14 pb-4 px-4 border-b border-gray-100">
            <View className="flex-row items-center">
              <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
                <ArrowLeft size={24} color="#111827" />
              </TouchableOpacity>
              <Text className="flex-1 text-center text-lg font-semibold text-gray-900">
                Quick Pay
              </Text>
              <View className="w-10" />
            </View>
          </View>

          <View className="flex-1 items-center justify-center p-8">
            <AlertCircle size={64} color="#DC2626" />
            <Text className="text-gray-900 text-xl font-semibold mt-4 text-center">
              {error}
            </Text>
            <TouchableOpacity
              onPress={() => router.back()}
              className="mt-6 bg-gray-900 px-6 py-3 rounded-xl"
            >
              <Text className="text-white font-semibold">Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-gray-50">
        {/* Header */}
        <View className="pt-14 pb-4 px-4 bg-white border-b border-gray-100">
          <View className="flex-row items-center">
            <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
              <ArrowLeft size={24} color="#111827" />
            </TouchableOpacity>
            <Text className="flex-1 text-center text-lg font-semibold text-gray-900">
              Pay {currentStore?.name}
            </Text>
            <View className="w-10" />
          </View>
        </View>

        <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
          {/* Store Info */}
          <View className="bg-white mx-4 mt-4 rounded-2xl p-6">
            <View className="items-center">
              <View className="w-20 h-20 rounded-full bg-secondary items-center justify-center mb-4">
                <Store size={40} color="#FF8A2A" />
              </View>

              <Text className="text-gray-900 text-xl font-bold text-center">
                {currentStore?.name}
              </Text>

              {currentStore?.isScVerified && (
                <View className="flex-row items-center mt-2 bg-green-100 px-3 py-1 rounded-full">
                  <Shield size={14} color="#16A34A" />
                  <Text className="text-green-700 text-sm font-medium ml-1">
                    Verified Store
                  </Text>
                </View>
              )}

              {currentStore?.shortCode && (
                <Text className="text-gray-400 text-sm mt-2">
                  Code: {currentStore.shortCode}
                </Text>
              )}
            </View>
          </View>

          {/* Payment Details */}
          <View className="bg-white mx-4 mt-4 rounded-2xl p-6">
            {paymentRequest?.description && (
              <View className="mb-4 pb-4 border-b border-gray-100">
                <Text className="text-gray-500 text-sm">Description</Text>
                <Text className="text-gray-900 text-lg">{paymentRequest.description}</Text>
              </View>
            )}

            {/* Amount */}
            <View className="mb-4">
              <Text className="text-gray-500 text-sm mb-2">Amount</Text>
              {paymentRequest?.amount !== null ? (
                <Text className="text-gray-900 text-4xl font-bold">
                  ${paymentRequest?.amount.toFixed(2)}
                </Text>
              ) : (
                <View className="flex-row items-center">
                  <Text className="text-gray-400 text-4xl">$</Text>
                  <TextInput
                    className="text-gray-900 text-4xl font-bold flex-1"
                    placeholder="0.00"
                    placeholderTextColor="#D1D5DB"
                    value={amount}
                    onChangeText={handleAmountChange}
                    keyboardType="decimal-pad"
                  />
                </View>
              )}
            </View>

            {/* Balance */}
            <View className="flex-row items-center justify-between py-3 border-t border-gray-100">
              <Text className="text-gray-500">Your Balance</Text>
              <Text className="text-gray-900 font-medium">{balanceFormatted}</Text>
            </View>

            {parseFloat(amount) > balance && (
              <View className="bg-yellow-50 rounded-xl p-3 mt-2">
                <Text className="text-yellow-800 text-sm">
                  Your default payment method will be charged for the difference.
                </Text>
              </View>
            )}

            {/* Note (only for store code payments) */}
            {!paymentRequest && (
              <View className="mt-4">
                <Text className="text-gray-500 text-sm mb-2">Note (optional)</Text>
                <TextInput
                  className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900"
                  placeholder="Add a note"
                  placeholderTextColor="#9CA3AF"
                  value={note}
                  onChangeText={setNote}
                  maxLength={100}
                />
              </View>
            )}

            {/* Expiration warning */}
            {paymentRequest?.expiresAt && (
              <View className="flex-row items-center mt-4 p-3 bg-gray-50 rounded-xl">
                <Clock size={16} color="#6B7280" />
                <Text className="text-gray-500 text-sm ml-2">
                  Request expires at{' '}
                  {new Date(paymentRequest.expiresAt).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            )}
          </View>

          {/* Pay Button */}
          <View className="mx-4 mt-6 mb-8">
            <TouchableOpacity
              onPress={handlePay}
              disabled={!canPay() || paying}
              className={`py-4 rounded-xl items-center ${
                canPay() && !paying ? 'bg-primary' : 'bg-gray-300'
              }`}
            >
              {paying ? (
                <View className="flex-row items-center">
                  <ActivityIndicator size="small" color="white" />
                  <Text className="text-white font-bold text-lg ml-2">Processing...</Text>
                </View>
              ) : (
                <Text className="text-white font-bold text-lg">
                  Pay ${parseFloat(amount || '0').toFixed(2)}
                </Text>
              )}
            </TouchableOpacity>

            <Text className="text-gray-400 text-xs text-center mt-3">
              You&apos;ll be asked to confirm with Face ID or fingerprint
            </Text>
          </View>
        </ScrollView>
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
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <View className="items-center mb-4">
              <View className="w-16 h-16 rounded-full bg-green-100 items-center justify-center mb-3">
                <CheckCircle size={32} color="#16A34A" />
              </View>
              <Text className="text-xl font-bold text-gray-900 text-center">
                Payment Sent!
              </Text>
            </View>
            <Text className="text-gray-600 text-center mb-6">{successMessage}</Text>
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

      {/* Error Modal */}
      <Modal
        visible={showErrorModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowErrorModal(false)}
      >
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <View className="items-center mb-4">
              <View className="w-16 h-16 rounded-full bg-red-100 items-center justify-center mb-3">
                <AlertCircle size={32} color="#DC2626" />
              </View>
              <Text className="text-xl font-bold text-gray-900 text-center">
                Payment Failed
              </Text>
            </View>
            <Text className="text-gray-600 text-center mb-6">{errorMessage}</Text>
            <TouchableOpacity
              onPress={() => setShowErrorModal(false)}
              className="bg-gray-900 py-3 rounded-xl items-center"
            >
              <Text className="text-white font-semibold">Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}
