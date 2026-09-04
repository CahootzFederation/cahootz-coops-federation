import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { router, Stack } from 'expo-router';
import { ArrowLeft, Plus, Landmark, Trash2, Check, X } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface BankAccount {
  id: string;
  accountHolderName: string;
  bankName: string;
  last4: string;
  routingLast4: string;
  isDefault: boolean;
  isVerified: boolean;
}

export default function BankAccountsScreen() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Add account form state
  const [accountHolderName, setAccountHolderName] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (user?.id) {
      loadAccounts();
    }
  }, [user?.id]);

  const loadAccounts = async () => {
    if (!user?.id) return;

    try {
      const result = await api.getBankAccounts(user.id, user.walletAddress);
      setAccounts(result.accounts);
    } catch (err) {
      console.error('Error loading bank accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setAccountHolderName('');
    setRoutingNumber('');
    setAccountNumber('');
    setConfirmAccountNumber('');
  };

  const handleAdd = async () => {
    if (!user?.id) return;

    // Validation
    if (!accountHolderName.trim()) {
      Alert.alert('Error', 'Please enter account holder name');
      return;
    }
    if (routingNumber.length !== 9) {
      Alert.alert('Error', 'Routing number must be 9 digits');
      return;
    }
    if (accountNumber.length < 4 || accountNumber.length > 17) {
      Alert.alert('Error', 'Please enter a valid account number');
      return;
    }
    if (accountNumber !== confirmAccountNumber) {
      Alert.alert('Error', 'Account numbers do not match');
      return;
    }

    setAdding(true);
    try {
      await api.addBankAccount(
        user.id,
        accountHolderName,
        routingNumber,
        accountNumber,
        undefined,
        user.walletAddress
      );
      setShowAddModal(false);
      resetForm();
      loadAccounts();
      Alert.alert('Success', 'Bank account added successfully');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to add bank account');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = (account: BankAccount) => {
    Alert.alert(
      'Remove Bank Account',
      `Remove account ending in ${account.last4}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.removeBankAccount(user!.id, account.id, user!.walletAddress);
              loadAccounts();
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to remove account');
            }
          },
        },
      ]
    );
  };

  const handleSetDefault = async (account: BankAccount) => {
    if (account.isDefault) return;

    try {
      await api.setDefaultBankAccount(user!.id, account.id, user!.walletAddress);
      loadAccounts();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to set default');
    }
  };

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
              Bank Accounts
            </Text>
          </View>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#6B7280" />
          </View>
        ) : (
          <ScrollView className="flex-1 p-4">
            {/* Account List */}
            {accounts.length === 0 ? (
              <View className="bg-white rounded-xl p-8 items-center">
                <Landmark size={48} color="#9CA3AF" />
                <Text className="text-gray-500 text-lg mt-4">No bank accounts</Text>
                <Text className="text-gray-400 text-center mt-2">
                  Add a bank account to withdraw funds
                </Text>
              </View>
            ) : (
              <View className="bg-white rounded-xl overflow-hidden">
                {accounts.map((account, index) => (
                  <TouchableOpacity
                    key={account.id}
                    onPress={() => handleSetDefault(account)}
                    className={`flex-row items-center p-4 ${
                      index < accounts.length - 1 ? 'border-b border-gray-100' : ''
                    }`}
                  >
                    <View className="w-12 h-12 rounded-full bg-secondary items-center justify-center mr-3">
                      <Landmark size={24} color="#FF6B00" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-gray-900 font-medium">{account.bankName}</Text>
                      <Text className="text-gray-500 text-sm">
                        {account.accountHolderName} ****{account.last4}
                      </Text>
                      {account.isDefault && (
                        <View className="flex-row items-center mt-1">
                          <Check size={12} color="#16A34A" />
                          <Text className="text-green-600 text-xs ml-1">Default</Text>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRemove(account)}
                      className="p-2"
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Trash2 size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Add Button */}
            <TouchableOpacity
              onPress={() => setShowAddModal(true)}
              className="mt-4 bg-primary rounded-xl py-4 flex-row items-center justify-center"
            >
              <Plus size={20} color="white" />
              <Text className="text-white font-semibold ml-2">Add Bank Account</Text>
            </TouchableOpacity>

            {/* Info */}
            <View className="mt-4 bg-secondary rounded-xl p-4">
              <Text className="text-amber-800 text-sm">
                Bank accounts are used for withdrawing funds. Tap an account to set it as your
                default for withdrawals.
              </Text>
            </View>
          </ScrollView>
        )}

        {/* Add Account Modal */}
        <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
          <View className="flex-1 bg-white">
            {/* Modal Header */}
            <View className="pt-14 pb-4 px-4 border-b border-gray-100">
              <View className="flex-row items-center">
                <TouchableOpacity
                  onPress={() => {
                    setShowAddModal(false);
                    resetForm();
                  }}
                  className="p-2 -ml-2"
                >
                  <X size={24} color="#111827" />
                </TouchableOpacity>
                <Text className="flex-1 text-center text-lg font-semibold text-gray-900 -ml-8">
                  Add Bank Account
                </Text>
              </View>
            </View>

            <ScrollView className="flex-1 p-4">
              {/* Account Holder Name */}
              <View className="mb-4">
                <Text className="text-gray-700 font-medium mb-2">Account Holder Name</Text>
                <TextInput
                  className="border border-gray-300 rounded-lg px-4 py-3 text-gray-900 bg-white"
                  placeholder="John Doe"
                  placeholderTextColor="#9CA3AF"
                  value={accountHolderName}
                  onChangeText={setAccountHolderName}
                  autoCapitalize="words"
                />
              </View>

              {/* Routing Number */}
              <View className="mb-4">
                <Text className="text-gray-700 font-medium mb-2">Routing Number</Text>
                <TextInput
                  className="border border-gray-300 rounded-lg px-4 py-3 text-gray-900 bg-white"
                  placeholder="9 digits"
                  placeholderTextColor="#9CA3AF"
                  value={routingNumber}
                  onChangeText={(text) => setRoutingNumber(text.replace(/\D/g, '').slice(0, 9))}
                  keyboardType="number-pad"
                  maxLength={9}
                />
              </View>

              {/* Account Number */}
              <View className="mb-4">
                <Text className="text-gray-700 font-medium mb-2">Account Number</Text>
                <TextInput
                  className="border border-gray-300 rounded-lg px-4 py-3 text-gray-900 bg-white"
                  placeholder="Account number"
                  placeholderTextColor="#9CA3AF"
                  value={accountNumber}
                  onChangeText={(text) => setAccountNumber(text.replace(/\D/g, '').slice(0, 17))}
                  keyboardType="number-pad"
                  secureTextEntry
                />
              </View>

              {/* Confirm Account Number */}
              <View className="mb-6">
                <Text className="text-gray-700 font-medium mb-2">Confirm Account Number</Text>
                <TextInput
                  className="border border-gray-300 rounded-lg px-4 py-3 text-gray-900 bg-white"
                  placeholder="Re-enter account number"
                  placeholderTextColor="#9CA3AF"
                  value={confirmAccountNumber}
                  onChangeText={(text) =>
                    setConfirmAccountNumber(text.replace(/\D/g, '').slice(0, 17))
                  }
                  keyboardType="number-pad"
                />
              </View>

              {/* Security Notice */}
              <View className="bg-gray-50 rounded-lg p-4 mb-6">
                <Text className="text-gray-600 text-sm">
                  Your bank account information is encrypted and securely stored. We use
                  industry-standard security measures to protect your data.
                </Text>
              </View>

              {/* Add Button */}
              <TouchableOpacity
                onPress={handleAdd}
                disabled={adding}
                className={`py-4 rounded-xl items-center ${adding ? 'bg-gray-300' : 'bg-primary'}`}
              >
                {adding ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className="text-white font-bold text-lg">Add Bank Account</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </Modal>
      </View>
    </>
  );
}
