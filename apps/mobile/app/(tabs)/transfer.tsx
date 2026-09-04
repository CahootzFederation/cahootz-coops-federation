import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react-native';
import { api } from '~/lib/api';
import { useAuth } from '~/contexts/auth-context';
import { authenticateForPayment, isBiometricAvailable, getBiometricName } from '~/lib/biometric';
import { coopConfig, formatCurrency } from '~/lib/coop-config';

type PaymentStep = 'recipient' | 'amount' | 'confirm' | 'success';

interface RecipientInfo {
  type: 'username' | 'phone';
  value: string;
  isSoulaanUser: boolean;
  userId?: string;
  displayName?: string;
}

export default function PayScreen() {
  const { user } = useAuth();
  const config = coopConfig();
  const [step, setStep] = useState<PaymentStep>('recipient');
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<number>(0);
  const [balanceFormatted, setBalanceFormatted] = useState<string>('$0.00');

  // Recipient state
  const [recipientInput, setRecipientInput] = useState('');
  const [recipientType, setRecipientType] = useState<'username' | 'phone'>('username');
  const [recipientInfo, setRecipientInfo] = useState<RecipientInfo | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Amount state
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  // Success state
  const [successMessage, setSuccessMessage] = useState('');
  const [transferId, setTransferId] = useState('');

  // Biometric state
  const [biometricName, setBiometricName] = useState('Biometrics');

  // Error modal state
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorTitle, setErrorTitle] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const showError = (title: string, message: string) => {
    setErrorTitle(title);
    setErrorMessage(message);
    setShowErrorModal(true);
  };

  useEffect(() => {
    if (user?.id) {
      loadBalance();
      loadBiometricInfo();
    }
  }, [user?.id]);

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

  const loadBiometricInfo = async () => {
    const name = await getBiometricName();
    setBiometricName(name);
  };

  const handleRecipientLookup = useCallback(async () => {
    if (!recipientInput.trim()) {
      setLookupError('Please enter a username or phone number');
      return;
    }

    setIsLookingUp(true);
    setLookupError(null);
    setRecipientInfo(null);

    try {
      const result = await api.lookupRecipient(
        recipientInput.trim(),
        recipientType,
        user?.walletAddress
      );

      if (result.found) {
        setRecipientInfo({
          type: recipientType,
          value: recipientInput.trim(),
          isSoulaanUser: result.isSoulaanUser,
          userId: result.userId,
          displayName: result.displayName,
        });
      } else {
        if (recipientType === 'phone') {
          // Phone number not in system - can still send
          setRecipientInfo({
            type: 'phone',
            value: recipientInput.trim(),
            isSoulaanUser: false,
          });
        } else {
          setLookupError('Username not found');
        }
      }
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setIsLookingUp(false);
    }
  }, [recipientInput, recipientType, user?.walletAddress]);

  const handleContinueToAmount = () => {
    if (!recipientInfo) {
      showError('Missing Recipient', 'Please select a recipient first');
      return;
    }
    setStep('amount');
  };

  const handleContinueToConfirm = () => {
    const amountNum = parseFloat(amount);

    if (!amount || amountNum <= 0) {
      showError('Invalid Amount', 'Please enter a valid amount');
      return;
    }

    if (amountNum < 0.01) {
      showError('Amount Too Small', 'Minimum payment amount is $0.01');
      return;
    }

    if (amountNum > 10000) {
      showError('Amount Too Large', 'Maximum payment amount is $10,000');
      return;
    }

    setStep('confirm');
  };

  const handleSendPayment = async () => {
    if (!user?.id || !recipientInfo) return;

    const amountNum = parseFloat(amount);

    // Authenticate with biometrics
    const authResult = await authenticateForPayment(`$${amountNum.toFixed(2)}`);
    if (!authResult.success) {
      if (authResult.error !== 'Authentication cancelled' && authResult.error !== 'Payment cancelled') {
        showError('Authentication Failed', authResult.error || 'Please try again');
      }
      return;
    }

    setLoading(true);

    try {
      const result = await api.sendPayment(
        user.id,
        recipientInfo.userId || recipientInfo.value,
        recipientInfo.userId ? 'userId' : recipientInfo.type,
        amountNum,
        note || undefined,
        user.walletAddress
      );

      setTransferId(result.transferId);
      setSuccessMessage(result.message);
      setStep('success');

      // Refresh balance
      loadBalance();
    } catch (err) {
      showError('Payment Failed', err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStep('recipient');
    setRecipientInput('');
    setRecipientInfo(null);
    setAmount('');
    setNote('');
    setSuccessMessage('');
    setTransferId('');
    setLookupError(null);
  };

  const formatPhoneNumber = (input: string) => {
    // Remove non-digits
    const cleaned = input.replace(/\D/g, '');

    // Format as (XXX) XXX-XXXX
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  };

  const handleInputChange = (text: string) => {
    if (recipientType === 'phone') {
      setRecipientInput(formatPhoneNumber(text));
    } else {
      setRecipientInput(text.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    }
    setRecipientInfo(null);
    setLookupError(null);
  };

  // Check if user has no wallet
  if (!user?.walletAddress) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-6">
        <Text className="text-xl font-bold text-gray-900 mb-4">No Wallet</Text>
        <Text className="text-center text-gray-600">
          You need a wallet to send payments
        </Text>
      </View>
    );
  }

  // Success Screen
  if (step === 'success') {
    return (
      <View className="flex-1 bg-green-500 items-center justify-center px-6">
        <View className="bg-white rounded-full w-24 h-24 items-center justify-center mb-6">
          <Text className="text-5xl">✓</Text>
        </View>
        <Text className="text-white text-3xl font-bold mb-2">Payment Sent!</Text>
        <Text className="text-white/90 text-lg text-center mb-8">{successMessage}</Text>

        {!recipientInfo?.isSoulaanUser && (
          <View className="bg-white/20 rounded-lg p-4 mb-8">
            <Text className="text-white text-center">
              They&apos;ll receive a text to claim the money
            </Text>
          </View>
        )}

        <TouchableOpacity
          onPress={resetForm}
          className="bg-white py-4 px-8 rounded-full"
        >
          <Text className="text-green-600 font-semibold text-lg">Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1"
    >
      <ScrollView className="flex-1 bg-gray-50">
        {/* Balance Header */}
        <View className="bg-white px-4 py-3 border-b border-gray-100">
          <Text className="text-gray-500 text-xs">Your Balance</Text>
          <Text className="text-gray-900 text-lg font-bold">{balanceFormatted}</Text>
        </View>

        {/* Step Indicator */}
        <View className="flex-row justify-center py-4 bg-white border-b border-gray-100">
          {['recipient', 'amount', 'confirm'].map((s, i) => (
            <View key={s} className="flex-row items-center">
              <View
                className={`w-8 h-8 rounded-full items-center justify-center ${
                  step === s
                    ? 'bg-primary'
                    : ['recipient', 'amount', 'confirm'].indexOf(step) > i
                    ? 'bg-green-500'
                    : 'bg-gray-200'
                }`}
              >
                <Text className="text-white font-semibold">{i + 1}</Text>
              </View>
              {i < 2 && <View className="w-8 h-0.5 bg-gray-200" />}
            </View>
          ))}
        </View>

        {/* Step 1: Recipient Selection */}
        {step === 'recipient' && (
          <View className="p-4">
            <Text className="text-2xl font-bold text-gray-900 mb-6">Who are you paying?</Text>

            {/* Toggle between username and phone */}
            <View className="flex-row mb-4 bg-gray-100 rounded-lg p-1">
              <TouchableOpacity
                onPress={() => {
                  setRecipientType('username');
                  setRecipientInput('');
                  setRecipientInfo(null);
                  setLookupError(null);
                }}
                className={`flex-1 py-3 rounded-md ${
                  recipientType === 'username' ? 'bg-white shadow-sm' : ''
                }`}
              >
                <Text
                  className={`text-center font-medium ${
                    recipientType === 'username' ? 'text-primary' : 'text-gray-600'
                  }`}
                >
                  Username
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setRecipientType('phone');
                  setRecipientInput('');
                  setRecipientInfo(null);
                  setLookupError(null);
                }}
                className={`flex-1 py-3 rounded-md ${
                  recipientType === 'phone' ? 'bg-white shadow-sm' : ''
                }`}
              >
                <Text
                  className={`text-center font-medium ${
                    recipientType === 'phone' ? 'text-primary' : 'text-gray-600'
                  }`}
                >
                  Phone
                </Text>
              </TouchableOpacity>
            </View>

            {/* Input */}
            <View className="bg-white rounded-xl shadow-sm p-4 mb-4">
              <Text className="text-gray-700 font-medium mb-2">
                {recipientType === 'username' ? 'Enter username' : 'Enter phone number'}
              </Text>
              <View className="flex-row">
                <TextInput
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-3 text-gray-900 text-lg"
                  placeholder={recipientType === 'username' ? '@username' : '(555) 123-4567'}
                  value={recipientInput}
                  onChangeText={handleInputChange}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={recipientType === 'phone' ? 'phone-pad' : 'default'}
                />
                <TouchableOpacity
                  onPress={handleRecipientLookup}
                  disabled={isLookingUp || !recipientInput.trim()}
                  className={`ml-2 px-6 py-3 rounded-lg items-center justify-center ${
                    isLookingUp || !recipientInput.trim() ? 'bg-gray-300' : 'bg-primary'
                  }`}
                >
                  {isLookingUp ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text className="text-white font-semibold">Find</Text>
                  )}
                </TouchableOpacity>
              </View>

              {lookupError && (
                <Text className="text-red-600 text-sm mt-2">{lookupError}</Text>
              )}

              {recipientInfo && (
                <View className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
                  <View className="flex-row items-center">
                    <View className="w-12 h-12 rounded-full bg-green-100 items-center justify-center mr-3">
                      <Text className="text-green-600 text-xl">
                        {recipientInfo.isSoulaanUser ? '✓' : '📱'}
                      </Text>
                    </View>
                    <View className="flex-1">
                      {recipientInfo.displayName ? (
                        <>
                          <Text className="text-green-800 font-semibold">
                            {recipientInfo.displayName}
                          </Text>
                          <Text className="text-green-600 text-sm">@{recipientInfo.value}</Text>
                        </>
                      ) : (
                        <Text className="text-green-800 font-semibold">
                          {recipientInfo.value}
                        </Text>
                      )}
                      <Text className="text-green-600 text-xs mt-1">
                        {recipientInfo.isSoulaanUser
                          ? `${config.shortName} member`
                          : 'Will receive via text message'}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </View>

            <TouchableOpacity
              onPress={handleContinueToAmount}
              disabled={!recipientInfo}
              className={`py-4 rounded-xl items-center ${
                recipientInfo ? 'bg-primary' : 'bg-gray-300'
              }`}
            >
              <Text className="text-white font-bold text-lg">Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step 2: Amount Entry */}
        {step === 'amount' && (
          <View className="p-4">
            {/* Recipient summary */}
            <TouchableOpacity
              onPress={() => setStep('recipient')}
              className="flex-row items-center bg-white rounded-lg p-3 mb-6"
            >
              <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center mr-3">
                <Text className="text-primary">
                  {recipientInfo?.isSoulaanUser ? '👤' : '📱'}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 font-medium">
                  {recipientInfo?.displayName || recipientInfo?.value}
                </Text>
                <Text className="text-gray-500 text-sm">Tap to change</Text>
              </View>
            </TouchableOpacity>

            <Text className="text-2xl font-bold text-gray-900 mb-6">How much?</Text>

            {/* Amount input - big and centered */}
            <View className="bg-white rounded-xl shadow-sm p-6 mb-4 items-center">
              <View className="flex-row items-baseline">
                <Text className="text-4xl text-gray-400 mr-1">$</Text>
                <TextInput
                  className="text-5xl font-bold text-gray-900 min-w-[100px] text-center"
                  placeholder="0"
                  value={amount}
                  onChangeText={(text) => {
                    // Only allow valid decimal numbers
                    const cleaned = text.replace(/[^0-9.]/g, '');
                    const parts = cleaned.split('.');
                    if (parts.length > 2) return;
                    if (parts[1]?.length > 2) return;
                    setAmount(cleaned);
                  }}
                  keyboardType="decimal-pad"
                  autoFocus
                />
              </View>

              {balance > 0 && (
                <TouchableOpacity
                  onPress={() => setAmount(balance.toString())}
                  className="mt-4 bg-gray-100 px-4 py-2 rounded-full"
                >
                  <Text className="text-gray-600">Use full balance</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Note input */}
            <View className="bg-white rounded-xl shadow-sm p-4 mb-4">
              <Text className="text-gray-700 font-medium mb-2">Add a note (optional)</Text>
              <TextInput
                className="border border-gray-300 rounded-lg px-4 py-3 text-gray-900"
                placeholder="What's it for?"
                value={note}
                onChangeText={setNote}
                maxLength={100}
              />
            </View>

            <View className="flex-row space-x-3">
              <TouchableOpacity
                onPress={() => setStep('recipient')}
                className="flex-1 py-4 rounded-xl items-center bg-gray-200"
              >
                <Text className="text-gray-700 font-bold text-lg">Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleContinueToConfirm}
                disabled={!amount || parseFloat(amount) <= 0}
                className={`flex-1 py-4 rounded-xl items-center ${
                  amount && parseFloat(amount) > 0 ? 'bg-primary' : 'bg-gray-300'
                }`}
              >
                <Text className="text-white font-bold text-lg">Review</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Step 3: Confirmation */}
        {step === 'confirm' && (
          <View className="p-4">
            <Text className="text-2xl font-bold text-gray-900 mb-6">Confirm Payment</Text>

            <View className="bg-white rounded-xl shadow-sm p-6 mb-6">
              {/* Amount */}
              <View className="items-center mb-6">
                <Text className="text-5xl font-bold text-gray-900">
                  ${parseFloat(amount).toFixed(2)}
                </Text>
              </View>

              {/* Recipient */}
              <View className="flex-row items-center py-4 border-t border-gray-100">
                <Text className="text-gray-500 w-20">To</Text>
                <View className="flex-1">
                  <Text className="text-gray-900 font-medium">
                    {recipientInfo?.displayName || recipientInfo?.value}
                  </Text>
                  {recipientInfo?.displayName && (
                    <Text className="text-gray-500 text-sm">
                      {recipientInfo.type === 'username' ? '@' : ''}
                      {recipientInfo.value}
                    </Text>
                  )}
                </View>
              </View>

              {/* Note */}
              {note && (
                <View className="flex-row items-center py-4 border-t border-gray-100">
                  <Text className="text-gray-500 w-20">Note</Text>
                  <Text className="text-gray-900 flex-1">{note}</Text>
                </View>
              )}

              {/* Funding source */}
              <View className="flex-row items-center py-4 border-t border-gray-100">
                <Text className="text-gray-500 w-20">From</Text>
                <Text className="text-gray-900">
                  {parseFloat(amount) <= balance
                    ? `${config.shortName} Balance`
                    : 'Card (will be charged)'}
                </Text>
              </View>

              {/* Non-user notice */}
              {!recipientInfo?.isSoulaanUser && (
                <View className="mt-4 bg-secondary border border-border rounded-lg p-3">
                  <Text className="text-amber-800 text-sm">
                    {recipientInfo?.value} is not on {config.shortName} yet. They&apos;ll receive a text
                    message to claim this payment within {config.claimExpirationDays} days.
                  </Text>
                </View>
              )}
            </View>

            {/* Biometric indicator */}
            <View className="bg-secondary rounded-lg p-3 mb-4 flex-row items-center justify-center">
              <Text className="text-amber-800 text-sm">
                You&apos;ll use {biometricName} to confirm
              </Text>
            </View>

            <View className="flex-row space-x-3">
              <TouchableOpacity
                onPress={() => setStep('amount')}
                className="flex-1 py-4 rounded-xl items-center bg-gray-200"
              >
                <Text className="text-gray-700 font-bold text-lg">Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSendPayment}
                disabled={loading}
                className="flex-1 py-4 rounded-xl items-center bg-green-600"
              >
                {loading ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className="text-white font-bold text-lg">
                    Pay ${parseFloat(amount).toFixed(2)}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Error Modal */}
      <Modal visible={showErrorModal} animationType="fade" transparent>
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm items-center">
            <View className="w-16 h-16 rounded-full bg-red-100 items-center justify-center mb-4">
              <AlertCircle size={32} color="#DC2626" />
            </View>
            <Text className="text-xl font-semibold text-gray-900 mb-2">
              {errorTitle}
            </Text>
            <Text className="text-gray-500 text-center mb-6">
              {errorMessage}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setShowErrorModal(false);
                setErrorTitle('');
                setErrorMessage('');
              }}
              className="bg-gray-900 rounded-xl py-3 px-8 w-full"
            >
              <Text className="text-white font-semibold text-center">OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
