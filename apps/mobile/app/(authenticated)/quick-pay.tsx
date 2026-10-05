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
import { friendlyError } from '@/lib/friendly-error';

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
  const { user, isLoading: authLoading } = useAuth();
  // Store codes are only unique within a commons. Wait for the saved session
  // to load (a reload or a deep link opens this screen cold) and use its commons.
  const coopId = user?.coop?.id;
  const params = useLocalSearchParams<{ token?: string; code?: string }>();

  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True when the screen failed to load (network/server), so "Try again" can help.
  const [canRetry, setCanRetry] = useState(false);

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
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // Modals
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const loadTarget = () => {
    setError(null);
    setCanRetry(false);
    if (params.token) {
      loadPaymentRequest(params.token);
    } else if (params.code) {
      if (!coopId) {
        setError("We couldn't tell which commons you're in. Go back and try again.");
        setLoading(false);
        return;
      }
      loadStoreByCode(params.code, coopId);
    } else {
      setError("This payment link doesn't work. Ask the store for a new one.");
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    loadTarget();
    loadBalance();
  }, [params.token, params.code, authLoading, coopId]);

  const loadBalance = async () => {
    if (!user?.id) return;

    try {
      setBalanceError(null);
      const result = await api.getUSDBalance(user.id, user.walletAddress);
      setBalance(result.balance);
      setBalanceFormatted(result.formatted);
    } catch (err) {
      console.error('Error loading balance:', err);
      setBalanceError(friendlyError(err, "We couldn't load your balance."));
    }
  };

  const loadPaymentRequest = async (token: string) => {
    try {
      setLoading(true);
      const result = await api.getPaymentRequest(token);

      if (!result.found) {
        setError("We couldn't find this payment request. Ask the store for a new one.");
        return;
      }

      if (result.isExpired) {
        setError('This payment request has expired. Ask the store for a new one.');
        return;
      }

      if (result.status !== 'PENDING') {
        setError(
          result.status === 'COMPLETED'
            ? 'This payment has already been made.'
            : 'This payment request can no longer be used. Ask the store for a new one.'
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
      setError(friendlyError(err, "We couldn't load this payment request."));
      setCanRetry(true);
    } finally {
      setLoading(false);
    }
  };

  const loadStoreByCode = async (code: string, storeCoopId: string) => {
    try {
      setLoading(true);
      const result = await api.getStoreByCode(code, storeCoopId);

      if (!result.found) {
        setError("We couldn't find a store with that code. Check the code and try again.");
        return;
      }

      setStore(result.store!);
    } catch (err) {
      console.error('Error loading store:', err);
      setError(friendlyError(err, "We couldn't load this store."));
      setCanRetry(true);
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

  const showPaymentError = (message: string) => {
    setErrorMessage(message);
    setShowErrorModal(true);
  };

  const handlePay = async () => {
    if (!canPay()) return;
    if (!user?.walletAddress) {
      showPaymentError("Your wallet isn't set up yet, so you can't pay right now. Please try again later.");
      return;
    }

    const amountNum = parseFloat(amount);

    // Face ID / fingerprint, or the Confirm Payment sheet where those aren't available.
    const authResult = await authenticateForPayment(`$${amountNum.toFixed(2)}`);
    if (!authResult.success) {
      // Backing out of Face ID or the confirm sheet isn't a failure.
      if (authResult.cancelled) return;
      showPaymentError(authResult.error || "We couldn't confirm this payment. Please try again.");
      return;
    }

    if (!paymentRequest && !store) {
      showPaymentError("We couldn't tell which store to pay. Go back and open the payment link again.");
      return;
    }

    setPaying(true);

    try {
      const result = paymentRequest
        ? await api.payRequest(params.token!, amountNum, user.walletAddress)
        : await api.payByStoreCode(
            store!.shortCode || params.code!,
            amountNum,
            note.trim() || undefined,
            user.walletAddress,
            coopId,
          );

      if (result?.success) {
        const storeName = paymentRequest?.store.name || store?.name;
        setSuccessMessage(`Paid $${amountNum.toFixed(2)} to ${storeName}`);
        setShowSuccessModal(true);
        loadBalance();
      } else {
        console.error('Quick pay returned no success:', result);
        showPaymentError(friendlyError({ message: result?.message }, "Your payment didn't go through."));
      }
    } catch (err) {
      console.error('Quick pay failed:', err);
      showPaymentError(friendlyError(err, "Your payment didn't go through."));
    } finally {
      setPaying(false);
    }
  };

  const currentStore = paymentRequest?.store || store;
  // A payment request can carry a fixed amount; a store code never does.
  const fixedAmount = paymentRequest?.amount != null ? paymentRequest.amount : null;
  const amountNum = parseFloat(amount);
  const hasValidAmount = canPay();

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
              <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2" accessibilityRole="button" accessibilityLabel="Go back">
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
            {canRetry && (
              <TouchableOpacity
                onPress={loadTarget}
                accessibilityRole="button"
                className="mt-6 bg-primary px-6 py-3 rounded-xl items-center justify-center"
                style={{ minHeight: 48 }}
              >
                <Text className="text-white font-semibold">Try again</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => router.back()}
              accessibilityRole="button"
              className={`${canRetry ? 'mt-3' : 'mt-6'} bg-gray-900 px-6 py-3 rounded-xl items-center justify-center`}
              style={{ minHeight: 48 }}
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
            <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2" accessibilityRole="button" accessibilityLabel="Go back">
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
              <Text nativeID="quick-pay-amount-label" className="text-gray-700 text-base font-medium mb-2">
                {fixedAmount != null ? 'Amount' : 'Amount in dollars'}
              </Text>
              {fixedAmount != null ? (
                <Text className="text-gray-900 text-4xl font-bold">
                  ${fixedAmount.toFixed(2)}
                </Text>
              ) : (
                <View className="flex-row items-center bg-gray-50 border border-gray-300 rounded-xl px-4">
                  <Text className="text-gray-500 text-4xl">$</Text>
                  <TextInput
                    className="text-gray-900 text-4xl font-bold flex-1 py-3 ml-1"
                    placeholder="0.00"
                    placeholderTextColor="#9CA3AF"
                    value={amount}
                    onChangeText={handleAmountChange}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    accessibilityLabel="Amount in dollars"
                    accessibilityLabelledBy="quick-pay-amount-label"
                    maxLength={8}
                  />
                </View>
              )}
            </View>

            {/* Balance */}
            {balanceError ? (
              <View className="py-3 border-t border-gray-100">
                <Text className="text-gray-700">{balanceError}</Text>
                <TouchableOpacity
                  onPress={loadBalance}
                  accessibilityRole="button"
                  className="mt-2 self-start bg-gray-100 px-4 rounded-xl items-center justify-center"
                  style={{ minHeight: 44 }}
                >
                  <Text className="text-gray-900 font-semibold">Try again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="flex-row items-center justify-between py-3 border-t border-gray-100">
                <Text className="text-gray-500">Your Balance</Text>
                <Text className="text-gray-900 font-medium">{balanceFormatted}</Text>
              </View>
            )}

            {!balanceError && amountNum > balance && (
              <View className="bg-yellow-50 rounded-xl p-3 mt-2">
                <Text className="text-yellow-800 text-sm">
                  This is more than your balance. If you have a default card saved, it pays the rest. If not, this payment won&apos;t go through.
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

          {/* Review: who gets paid and how much, right above the Pay button */}
          {hasValidAmount && currentStore && (
            <View
              className="bg-white mx-4 mt-4 rounded-2xl p-5 border border-gray-200"
              accessibilityLabel={`Review: you are paying ${currentStore.name} $${amountNum.toFixed(2)}`}
            >
              <Text className="text-gray-900 text-lg font-semibold mb-3">Review your payment</Text>
              <View className="flex-row justify-between py-1">
                <Text className="text-gray-600 text-base">To</Text>
                <Text className="text-gray-900 text-base font-semibold flex-1 text-right ml-4">
                  {currentStore.name}
                </Text>
              </View>
              <View className="flex-row justify-between py-1">
                <Text className="text-gray-600 text-base">Amount</Text>
                <Text className="text-gray-900 text-base font-semibold">${amountNum.toFixed(2)}</Text>
              </View>
              {!paymentRequest && note.trim() !== '' && (
                <View className="flex-row justify-between py-1">
                  <Text className="text-gray-600 text-base">Note</Text>
                  <Text className="text-gray-900 text-base flex-1 text-right ml-4">{note.trim()}</Text>
                </View>
              )}
            </View>
          )}

          {/* Pay Button */}
          <View className="mx-4 mt-6 mb-8">
            <TouchableOpacity
              onPress={handlePay}
              disabled={!hasValidAmount || paying}
              accessibilityRole="button"
              accessibilityState={{ disabled: !hasValidAmount || paying }}
              className={`py-4 rounded-xl items-center ${
                hasValidAmount && !paying ? 'bg-primary' : 'bg-gray-300'
              }`}
              style={{ minHeight: 56 }}
            >
              {paying ? (
                <View className="flex-row items-center">
                  <ActivityIndicator size="small" color="white" />
                  <Text className="text-white font-bold text-lg ml-2">Processing...</Text>
                </View>
              ) : (
                <Text className="text-white font-bold text-lg">
                  {hasValidAmount ? `Pay $${amountNum.toFixed(2)}` : 'Enter an amount to pay'}
                </Text>
              )}
            </TouchableOpacity>

            <Text className="text-gray-400 text-xs text-center mt-3">
              You&apos;ll confirm with Face ID, your fingerprint, or a Confirm button before any money moves.
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
                Payment didn&apos;t go through
              </Text>
            </View>
            <Text className="text-gray-600 text-center mb-6">{errorMessage}</Text>
            <TouchableOpacity
              onPress={() => setShowErrorModal(false)}
              accessibilityRole="button"
              className="bg-gray-900 py-3 rounded-xl items-center justify-center"
              style={{ minHeight: 48 }}
            >
              <Text className="text-white font-semibold">OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}
