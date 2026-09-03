import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useState, useEffect } from 'react';
import { router, Stack } from 'expo-router';
import { ArrowLeft, Landmark, ChevronRight, Plus, Check } from 'lucide-react-native';
import { api } from '~/lib/api';
import { useAuth } from '~/contexts/auth-context';
import { authenticateForPayment } from '~/lib/biometric';

interface BankAccount {
  id: string;
  accountHolderName: string;
  bankName: string;
  last4: string;
  routingLast4: string;
  isDefault: boolean;
  isVerified: boolean;
}

export default function WithdrawScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [balance, setBalance] = useState<number>(0);
  const [amount, setAmount] = useState('');

  // Bank accounts
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null);
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  useEffect(() => {
    if (user?.id) {
      loadData();
    }
  }, [user?.id]);

  const loadData = async () => {
    if (!user?.id) return;

    try {
      const [balanceResult, accountsResult] = await Promise.all([
        api.getUSDBalance(user.id, user.walletAddress),
        api.getBankAccounts(user.id, user.walletAddress),
      ]);

      setBalance(balanceResult.balance);
      setBankAccounts(accountsResult.accounts);

      // Select default account
      const defaultAccount = accountsResult.accounts.find((a: BankAccount) => a.isDefault);
      if (defaultAccount) {
        setSelectedAccount(defaultAccount);
      } else if (accountsResult.accounts.length > 0) {
        setSelectedAccount(accountsResult.accounts[0]);
      }
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!user?.id || !selectedAccount) return;

    const amountNum = parseFloat(amount);

    // Validation
    if (!amount || amountNum <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    if (amountNum > balance) {
      Alert.alert('Error', 'Insufficient balance');
      return;
    }

    if (amountNum < 1) {
      Alert.alert('Error', 'Minimum withdrawal is $1.00');
      return;
    }

    // Biometric authentication
    const authResult = await authenticateForPayment(`$${amountNum.toFixed(2)}`);
    if (!authResult.success) {
      if (authResult.error) {
        Alert.alert('Authentication Failed', authResult.error);
      }
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.withdraw(
        user.id,
        selectedAccount.id,
        amountNum,
        user.walletAddress
      );

      Alert.alert(
        'Withdrawal Initiated',
        `$${amountNum.toFixed(2)} is being sent to your account ending in ${selectedAccount.last4}.\n\nExpected arrival: ${result.eta}`,
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Withdrawal failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAmountChange = (text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    if (parts[1]?.length > 2) return;
    setAmount(cleaned);
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View className="flex-1 bg-gray-50 items-center justify-center">
          <ActivityIndicator size="large" color="#6B7280" />
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
            <Text className="flex-1 text-center text-lg font-semibold text-gray-900 -ml-8">
              Withdraw to Bank
            </Text>
          </View>
        </View>

        <ScrollView className="flex-1">
          <View className="p-4">
            {/* Bank Account Selection */}
            <Text className="text-gray-900 font-semibold text-lg mb-3">Withdraw To</Text>

            {bankAccounts.length === 0 ? (
              <TouchableOpacity
                onPress={() => router.push('/(authenticated)/bank-accounts' as any)}
                className="bg-white rounded-xl p-4 flex-row items-center mb-4 border border-gray-200"
              >
                <View className="w-12 h-12 rounded-full bg-gray-100 items-center justify-center mr-3">
                  <Plus size={24} color="#6B7280" />
                </View>
                <View className="flex-1">
                  <Text className="text-gray-900 font-medium">Add Bank Account</Text>
                  <Text className="text-gray-500 text-sm">Required for withdrawals</Text>
                </View>
                <ChevronRight size={20} color="#9CA3AF" />
              </TouchableOpacity>
            ) : (
              <>
                {/* Selected Account */}
                <TouchableOpacity
                  onPress={() => setShowAccountPicker(!showAccountPicker)}
                  className="bg-white rounded-xl p-4 flex-row items-center mb-2 border border-gray-200"
                >
                  <View className="w-12 h-12 rounded-full bg-secondary items-center justify-center mr-3">
                    <Landmark size={24} color="#FF6B00" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-gray-900 font-medium">
                      {selectedAccount?.bankName || 'Select Account'}
                    </Text>
                    <Text className="text-gray-500 text-sm">
                      {selectedAccount
                        ? `****${selectedAccount.last4}`
                        : 'Tap to select a bank account'}
                    </Text>
                  </View>
                  <ChevronRight
                    size={20}
                    color="#9CA3AF"
                    style={{ transform: [{ rotate: showAccountPicker ? '90deg' : '0deg' }] }}
                  />
                </TouchableOpacity>

                {/* Account Picker Dropdown */}
                {showAccountPicker && (
                  <View className="bg-white rounded-xl border border-gray-200 mb-4 overflow-hidden">
                    {bankAccounts.map((account, index) => (
                      <TouchableOpacity
                        key={account.id}
                        onPress={() => {
                          setSelectedAccount(account);
                          setShowAccountPicker(false);
                        }}
                        className={`flex-row items-center p-4 ${
                          index < bankAccounts.length - 1 ? 'border-b border-gray-100' : ''
                        }`}
                      >
                        <View className="w-10 h-10 rounded-full bg-gray-100 items-center justify-center mr-3">
                          <Landmark size={20} color="#6B7280" />
                        </View>
                        <View className="flex-1">
                          <Text className="text-gray-900">{account.bankName}</Text>
                          <Text className="text-gray-500 text-sm">****{account.last4}</Text>
                        </View>
                        {selectedAccount?.id === account.id && (
                          <Check size={20} color="#FF6B00" />
                        )}
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      onPress={() => {
                        setShowAccountPicker(false);
                        router.push('/(authenticated)/bank-accounts' as any);
                      }}
                      className="flex-row items-center p-4 border-t border-gray-100"
                    >
                      <View className="w-10 h-10 rounded-full bg-gray-100 items-center justify-center mr-3">
                        <Plus size={20} color="#6B7280" />
                      </View>
                      <Text className="text-primary">Add New Account</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}

            {/* Amount Input */}
            <Text className="text-gray-900 font-semibold text-lg mb-3 mt-4">Amount</Text>
            <View className="bg-white rounded-xl p-4 mb-4 border border-gray-200">
              <View className="flex-row items-center">
                <Text className="text-gray-500 text-2xl mr-2">$</Text>
                <TextInput
                  className="flex-1 text-gray-900 text-2xl font-bold"
                  placeholder="0.00"
                  placeholderTextColor="#D1D5DB"
                  value={amount}
                  onChangeText={handleAmountChange}
                  keyboardType="decimal-pad"
                />
              </View>
              {balance > 0 && (
                <TouchableOpacity
                  onPress={() => setAmount(balance.toString())}
                  className="mt-2"
                >
                  <Text className="text-primary text-sm">Withdraw full balance</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Info Box */}
            <View className="bg-secondary rounded-lg p-4 mb-4">
              <Text className="text-amber-800 text-sm font-medium mb-1">Processing Time</Text>
              <Text className="text-primary text-sm">
                Withdrawals typically arrive in 1-3 business days. There are no fees for
                standard withdrawals.
              </Text>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              onPress={handleWithdraw}
              disabled={
                submitting ||
                !amount ||
                parseFloat(amount) <= 0 ||
                !selectedAccount ||
                bankAccounts.length === 0
              }
              className={`py-4 rounded-xl items-center ${
                submitting ||
                !amount ||
                parseFloat(amount) <= 0 ||
                !selectedAccount ||
                bankAccounts.length === 0
                  ? 'bg-gray-300'
                  : 'bg-primary'
              }`}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="text-white font-bold text-lg">
                  Withdraw {amount ? `$${parseFloat(amount).toFixed(2)}` : ''}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </>
  );
}
