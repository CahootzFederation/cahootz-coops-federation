import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Share,
  Modal,
  Clipboard,
} from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { router, Stack } from 'expo-router';
import {
  ArrowLeft,
  QrCode,
  Copy,
  Share2,
  Check,
  RefreshCw,
  Clock,
  DollarSign,
  History,
} from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface PaymentRequest {
  requestId: string;
  token: string;
  qrCodeData: string;
  paymentUrl: string;
  amount?: number;
  description?: string;
  expiresAt?: string;
}

export default function AcceptPaymentScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [hasStore, setHasStore] = useState(false);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [shortCode, setShortCode] = useState<string | null>(null);
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);

  // Payment request form
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  // Generated payment request
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [showRequestModal, setShowRequestModal] = useState(false);

  // Copied state
  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    loadQuickPayInfo();
  }, []);

  const loadQuickPayInfo = async () => {
    if (!user?.walletAddress) return;

    try {
      setLoading(true);
      const info = await api.getQuickPayInfo(user.walletAddress);
      setHasStore(info.hasStore);
      setStoreName(info.storeName);
      setShortCode(info.shortCode);
      setQrCodeData(info.qrCodeData);
    } catch (err) {
      console.error('Error loading quick pay info:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCode = async () => {
    if (!user?.walletAddress || shortCode) return;

    try {
      setGenerating(true);
      const result = await api.generateShortCode(undefined, user.walletAddress);
      setShortCode(result.shortCode);
      setQrCodeData(result.qrCodeData);
    } catch (err) {
      console.error('Error generating code:', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleCreatePaymentRequest = async () => {
    if (!user?.walletAddress) return;

    const amountNum = amount ? parseFloat(amount) : undefined;

    try {
      setGenerating(true);
      const result = await api.createPaymentRequest(
        {
          amount: amountNum,
          description: description || undefined,
          expiresInMinutes: 60, // 1 hour default
        },
        user.walletAddress
      );

      setPaymentRequest(result);
      setShowRequestModal(true);
      setAmount('');
      setDescription('');
    } catch (err) {
      console.error('Error creating payment request:', err);
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = async (text: string, type: 'code' | 'link') => {
    await Clipboard.setString(text);
    if (type === 'code') {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } else {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const sharePaymentLink = async () => {
    if (!paymentRequest) return;

    const message = paymentRequest.amount
      ? `Pay $${paymentRequest.amount.toFixed(2)} to ${storeName}: ${paymentRequest.paymentUrl}`
      : `Pay ${storeName}: ${paymentRequest.paymentUrl}`;

    try {
      await Share.share({
        message,
        url: paymentRequest.paymentUrl,
      });
    } catch (err) {
      console.error('Error sharing:', err);
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
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#FF8A2A" />
      </View>
    );
  }

  if (!hasStore) {
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
                Accept Payment
              </Text>
              <View className="w-10" />
            </View>
          </View>

          <View className="flex-1 items-center justify-center p-8">
            <QrCode size={64} color="#9CA3AF" />
            <Text className="text-gray-500 text-lg mt-4 text-center">
              You need an approved store to accept payments
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(authenticated)/apply-store' as any)}
              className="mt-6 bg-primary px-6 py-3 rounded-xl"
            >
              <Text className="text-white font-semibold">Apply for a Store</Text>
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
              Accept Payment
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(authenticated)/store-payments' as any)}
              className="p-2 -mr-2"
            >
              <History size={24} color="#6B7280" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {/* Store QR Code */}
          <View className="bg-white mx-4 mt-4 rounded-2xl p-6 items-center">
            <Text className="text-gray-500 text-sm mb-2">Your Store Code</Text>
            <Text className="text-gray-900 text-xl font-bold mb-4">{storeName}</Text>

            {shortCode && qrCodeData ? (
              <>
                <View className="bg-white p-4 rounded-xl border border-gray-200">
                  <QRCode value={qrCodeData} size={180} />
                </View>

                <View className="mt-4 flex-row items-center bg-gray-100 rounded-xl px-4 py-3">
                  <Text className="text-gray-900 font-mono text-lg font-bold flex-1">
                    {shortCode}
                  </Text>
                  <TouchableOpacity
                    onPress={() => copyToClipboard(shortCode, 'code')}
                    className="p-2"
                  >
                    {codeCopied ? (
                      <Check size={20} color="#16A34A" />
                    ) : (
                      <Copy size={20} color="#6B7280" />
                    )}
                  </TouchableOpacity>
                </View>

                <Text className="text-gray-400 text-xs mt-3 text-center">
                  Customers can scan this QR code or enter your store code to pay
                </Text>
              </>
            ) : (
              <TouchableOpacity
                onPress={handleGenerateCode}
                disabled={generating}
                className="bg-primary px-6 py-3 rounded-xl flex-row items-center"
              >
                {generating ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <QrCode size={20} color="white" />
                    <Text className="text-white font-semibold ml-2">
                      Generate Store Code
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Create Payment Request */}
          <View className="bg-white mx-4 mt-4 rounded-2xl p-6">
            <Text className="text-gray-900 font-semibold text-lg mb-4">
              Create Payment Request
            </Text>

            <View className="mb-4">
              <Text className="text-gray-600 text-sm mb-2">Amount (optional)</Text>
              <View className="flex-row items-center bg-gray-100 rounded-xl px-4 py-3">
                <DollarSign size={20} color="#6B7280" />
                <TextInput
                  className="flex-1 ml-2 text-gray-900 text-lg"
                  placeholder="0.00"
                  placeholderTextColor="#9CA3AF"
                  value={amount}
                  onChangeText={handleAmountChange}
                  keyboardType="decimal-pad"
                />
              </View>
              <Text className="text-gray-400 text-xs mt-1">
                Leave empty to let customer enter amount
              </Text>
            </View>

            <View className="mb-4">
              <Text className="text-gray-600 text-sm mb-2">Description (optional)</Text>
              <TextInput
                className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900"
                placeholder="e.g., Coffee + Pastry"
                placeholderTextColor="#9CA3AF"
                value={description}
                onChangeText={setDescription}
                maxLength={100}
              />
            </View>

            <TouchableOpacity
              onPress={handleCreatePaymentRequest}
              disabled={generating}
              className={`py-4 rounded-xl items-center flex-row justify-center ${
                generating ? 'bg-amber-400' : 'bg-primary'
              }`}
            >
              {generating ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <>
                  <QrCode size={20} color="white" />
                  <Text className="text-white font-bold text-lg ml-2">
                    Generate QR Code
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Tips */}
          <View className="mx-4 mt-4 mb-8 p-4 bg-secondary rounded-xl">
            <Text className="text-amber-800 text-sm font-medium mb-2">Tips</Text>
            <Text className="text-primary text-sm">
              {'\u2022'} Print your store QR code for quick payments{'\n'}
              {'\u2022'} Create payment requests with specific amounts{'\n'}
              {'\u2022'} Share payment links via SMS or messaging apps
            </Text>
          </View>
        </ScrollView>
      </View>

      {/* Payment Request Modal */}
      <Modal
        visible={showRequestModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRequestModal(false)}
      >
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-xl font-bold text-gray-900 text-center mb-4">
              Payment Request Created
            </Text>

            {paymentRequest && (
              <>
                <View className="items-center mb-4">
                  <View className="bg-white p-3 rounded-xl border border-gray-200">
                    <QRCode value={paymentRequest.qrCodeData} size={160} />
                  </View>
                </View>

                {paymentRequest.amount && (
                  <Text className="text-2xl font-bold text-gray-900 text-center mb-2">
                    ${paymentRequest.amount.toFixed(2)}
                  </Text>
                )}

                {paymentRequest.description && (
                  <Text className="text-gray-500 text-center mb-4">
                    {paymentRequest.description}
                  </Text>
                )}

                <View className="flex-row items-center bg-gray-100 rounded-xl px-3 py-2 mb-4">
                  <Clock size={16} color="#6B7280" />
                  <Text className="text-gray-500 text-sm ml-2">Expires in 1 hour</Text>
                </View>

                <TouchableOpacity
                  onPress={sharePaymentLink}
                  className="bg-primary py-3 rounded-xl items-center flex-row justify-center mb-3"
                >
                  <Share2 size={20} color="white" />
                  <Text className="text-white font-semibold ml-2">Share Link</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => copyToClipboard(paymentRequest.paymentUrl, 'link')}
                  className="bg-gray-100 py-3 rounded-xl items-center flex-row justify-center mb-3"
                >
                  {linkCopied ? (
                    <>
                      <Check size={20} color="#16A34A" />
                      <Text className="text-green-600 font-semibold ml-2">Copied!</Text>
                    </>
                  ) : (
                    <>
                      <Copy size={20} color="#6B7280" />
                      <Text className="text-gray-700 font-semibold ml-2">Copy Link</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setShowRequestModal(false)}
                  className="py-3 rounded-xl items-center"
                >
                  <Text className="text-gray-500 font-semibold">Done</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}
