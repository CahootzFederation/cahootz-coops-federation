import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useState, useEffect } from 'react';
import { router, Stack } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowLeft,
  Plus,
  CreditCard,
  Trash2,
  Check,
  CheckCircle,
  AlertCircle,
  X,
  Coins,
  Copy,
  KeyRound,
} from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import CardInput from '@/components/stripe/CardInput';

interface PaymentMethod {
  id: string;
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  isDefault: boolean;
}

interface AddedCard {
  brand: string;
  last4: string;
}

const brandColors: Record<string, string> = {
  visa: '#1A1F71',
  mastercard: '#EB001B',
  amex: '#006FCF',
  discover: '#FF6000',
  default: '#6B7280',
};

const brandNames: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  default: 'Card',
};

export default function PaymentMethodsScreen() {
  const { user } = useAuth();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState(false);
  const [scBalance, setScBalance] = useState<string | null>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showConfirmRemoveModal, setShowConfirmRemoveModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);

  // Modal data
  const [addedCard, setAddedCard] = useState<AddedCard | null>(null);
  const [cardToRemove, setCardToRemove] = useState<PaymentMethod | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (user?.id) {
      loadMethods();
    }
    if (user?.walletAddress) {
      loadBalance();
    }
  }, [user?.id, user?.walletAddress]);

  const loadMethods = async () => {
    if (!user?.id) return;

    try {
      const result = await api.getPaymentMethods(user.id, user.walletAddress);
      setMethods(result.methods);
    } catch (err) {
      console.error('Error loading payment methods:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadBalance = async () => {
    if (!user?.walletAddress) return;

    try {
      const result = await api.getTokenBalances(user.walletAddress);
      setScBalance(result.sc);
    } catch (err) {
      console.error('Error loading SC balance:', err);
    }
  };

  const handleCopyAddress = async () => {
    if (!user?.walletAddress) return;
    await Clipboard.setStringAsync(user.walletAddress);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const shortenAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

  const handleAddSuccess = (card: { brand: string; last4: string }) => {
    setShowAddModal(false);
    setAddedCard(card);
    setShowSuccessModal(true);
    loadMethods();
  };

  const handleRemovePress = (method: PaymentMethod) => {
    setCardToRemove(method);
    setShowConfirmRemoveModal(true);
  };

  const handleConfirmRemove = async () => {
    if (!cardToRemove || !user) return;

    setRemoving(true);
    try {
      await api.removePaymentMethod(user.id, cardToRemove.id, user.walletAddress);
      setShowConfirmRemoveModal(false);
      setCardToRemove(null);
      loadMethods();
    } catch (err) {
      setShowConfirmRemoveModal(false);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to remove card');
      setShowErrorModal(true);
    } finally {
      setRemoving(false);
    }
  };

  const handleSetDefault = async (method: PaymentMethod) => {
    if (method.isDefault) return;

    try {
      await api.setDefaultPaymentMethod(user!.id, method.id, user!.walletAddress);
      loadMethods();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to set default');
      setShowErrorModal(true);
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
              Wallet
            </Text>
          </View>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#6B7280" />
          </View>
        ) : (
          <ScrollView className="flex-1 p-4">
            {/* SC Balance + Wallet Address */}
            <View className="bg-white rounded-xl p-4">
              <View className="flex-row items-center gap-3">
                <View className="w-12 h-12 rounded-full bg-secondary items-center justify-center">
                  <Coins size={22} color="#B45309" />
                </View>
                <View className="flex-1">
                  <Text className="text-gray-500 text-xs uppercase font-semibold">SoulaaniCoin Balance</Text>
                  <Text className="text-gray-900 text-2xl font-bold">
                    {scBalance === null ? '—' : `${scBalance} SC`}
                  </Text>
                </View>
              </View>

              {user?.walletAddress ? (
                <TouchableOpacity
                  onPress={handleCopyAddress}
                  className="mt-4 flex-row items-center justify-between rounded-lg bg-gray-50 p-3"
                  activeOpacity={0.75}
                >
                  <View className="flex-1 min-w-0">
                    <Text className="text-gray-500 text-xs uppercase font-semibold">Wallet Address</Text>
                    <Text className="text-gray-800 text-sm mt-0.5" style={{ fontFamily: 'monospace' }}>
                      {shortenAddress(user.walletAddress)}
                    </Text>
                  </View>
                  {copiedAddress ? <Check size={18} color="#16A34A" /> : <Copy size={18} color="#6B7280" />}
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                onPress={() => router.push('/export-wallet' as any)}
                className="mt-3 flex-row items-center justify-center gap-2 rounded-lg border border-gray-200 py-3"
                activeOpacity={0.75}
              >
                <KeyRound size={16} color="#374151" />
                <Text className="text-gray-700 font-semibold text-sm">Export Wallet</Text>
              </TouchableOpacity>
            </View>

            {/* Card List */}
            <Text className="text-gray-500 text-xs uppercase font-semibold mt-6 mb-2 px-1">Payment Methods</Text>
            {methods.length === 0 ? (
              <View className="bg-white rounded-xl p-8 items-center">
                <CreditCard size={48} color="#9CA3AF" />
                <Text className="text-gray-500 text-lg mt-4">No payment methods</Text>
                <Text className="text-gray-400 text-center mt-2">
                  Add a card to fund payments when your balance is low
                </Text>
              </View>
            ) : (
              <View className="bg-white rounded-xl overflow-hidden">
                {methods.map((method, index) => (
                  <TouchableOpacity
                    key={method.id}
                    onPress={() => handleSetDefault(method)}
                    className={`flex-row items-center p-4 ${
                      index < methods.length - 1 ? 'border-b border-gray-100' : ''
                    }`}
                  >
                    <View
                      className="w-12 h-12 rounded-lg items-center justify-center mr-3"
                      style={{
                        backgroundColor: `${brandColors[method.brand] || brandColors.default}15`,
                      }}
                    >
                      <CreditCard
                        size={24}
                        color={brandColors[method.brand] || brandColors.default}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-gray-900 font-medium">
                        {brandNames[method.brand] || 'Card'} ****{method.last4}
                      </Text>
                      <Text className="text-gray-500 text-sm">
                        Expires {method.expiryMonth.toString().padStart(2, '0')}/
                        {method.expiryYear.toString().slice(-2)}
                      </Text>
                      {method.isDefault && (
                        <View className="flex-row items-center mt-1">
                          <Check size={12} color="#16A34A" />
                          <Text className="text-green-600 text-xs ml-1">Default</Text>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRemovePress(method)}
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
              <Text className="text-white font-semibold ml-2">Add Card</Text>
            </TouchableOpacity>

            {/* Info */}
            <View className="mt-4 bg-secondary rounded-xl p-4">
              <Text className="text-amber-800 text-sm">
                Your default card will be charged automatically when your balance is insufficient
                for a payment. Tap a card to set it as default.
              </Text>
            </View>
          </ScrollView>
        )}

        {/* Add Card Modal */}
        <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
          <CardInput
            onSuccess={handleAddSuccess}
            onCancel={() => setShowAddModal(false)}
          />
        </Modal>

        {/* Success Modal */}
        <Modal visible={showSuccessModal} animationType="fade" transparent>
          <View className="flex-1 bg-black/50 items-center justify-center p-6">
            <View className="bg-white rounded-2xl p-6 w-full max-w-sm items-center">
              <View className="w-16 h-16 rounded-full bg-green-100 items-center justify-center mb-4">
                <CheckCircle size={32} color="#16A34A" />
              </View>
              <Text className="text-xl font-semibold text-gray-900 mb-2">
                Card Added
              </Text>
              <Text className="text-gray-500 text-center mb-1">
                Your {brandNames[addedCard?.brand || ''] || 'card'} ending in {addedCard?.last4} has been added.
              </Text>
              <Text className="text-gray-400 text-sm text-center mb-6">
                You can now use this card for payments.
              </Text>
              <TouchableOpacity
                onPress={() => setShowSuccessModal(false)}
                className="bg-primary rounded-xl py-3 px-8 w-full"
              >
                <Text className="text-white font-semibold text-center">Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Confirm Remove Modal */}
        <Modal visible={showConfirmRemoveModal} animationType="fade" transparent>
          <View className="flex-1 bg-black/50 items-center justify-center p-6">
            <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
              <View className="flex-row justify-between items-center mb-4">
                <Text className="text-xl font-semibold text-gray-900">
                  Remove Card
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setShowConfirmRemoveModal(false);
                    setCardToRemove(null);
                  }}
                  className="p-1"
                >
                  <X size={24} color="#6B7280" />
                </TouchableOpacity>
              </View>

              {cardToRemove && (
                <View className="bg-gray-50 rounded-xl p-4 mb-4 flex-row items-center">
                  <View
                    className="w-12 h-12 rounded-lg items-center justify-center mr-3"
                    style={{
                      backgroundColor: `${brandColors[cardToRemove.brand] || brandColors.default}15`,
                    }}
                  >
                    <CreditCard
                      size={24}
                      color={brandColors[cardToRemove.brand] || brandColors.default}
                    />
                  </View>
                  <View>
                    <Text className="text-gray-900 font-medium">
                      {brandNames[cardToRemove.brand] || 'Card'} ****{cardToRemove.last4}
                    </Text>
                    <Text className="text-gray-500 text-sm">
                      Expires {cardToRemove.expiryMonth.toString().padStart(2, '0')}/
                      {cardToRemove.expiryYear.toString().slice(-2)}
                    </Text>
                  </View>
                </View>
              )}

              <Text className="text-gray-500 text-center mb-6">
                Are you sure you want to remove this card? This action cannot be undone.
              </Text>

              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => {
                    setShowConfirmRemoveModal(false);
                    setCardToRemove(null);
                  }}
                  className="flex-1 bg-gray-100 rounded-xl py-3"
                  disabled={removing}
                >
                  <Text className="text-gray-700 font-semibold text-center">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleConfirmRemove}
                  className="flex-1 bg-red-600 rounded-xl py-3"
                  disabled={removing}
                >
                  {removing ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text className="text-white font-semibold text-center">Remove</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Error Modal */}
        <Modal visible={showErrorModal} animationType="fade" transparent>
          <View className="flex-1 bg-black/50 items-center justify-center p-6">
            <View className="bg-white rounded-2xl p-6 w-full max-w-sm items-center">
              <View className="w-16 h-16 rounded-full bg-red-100 items-center justify-center mb-4">
                <AlertCircle size={32} color="#DC2626" />
              </View>
              <Text className="text-xl font-semibold text-gray-900 mb-2">
                Error
              </Text>
              <Text className="text-gray-500 text-center mb-6">
                {errorMessage}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowErrorModal(false);
                  setErrorMessage('');
                }}
                className="bg-gray-900 rounded-xl py-3 px-8 w-full"
              >
                <Text className="text-white font-semibold text-center">OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </>
  );
}
