import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Package,
  Clock,
  Truck,
  CheckCircle,
  XCircle,
  MapPin,
  CreditCard,
  AlertCircle,
  ExternalLink,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { useCoin } from '@/contexts/platform-config-context';
import { api } from '@/lib/api';

interface OrderDetailHybridProps {
  orderId: string;
}

const STATUS_CONFIG: Record<string, { color: string; bgColor: string; icon: any; label: string }> = {
  PENDING: { color: '#FF8A2A', bgColor: 'bg-secondary dark:bg-amber-900/30', icon: Clock, label: 'Pending' },
  PROCESSING: { color: '#2563EB', bgColor: 'bg-blue-100 dark:bg-blue-900/30', icon: CreditCard, label: 'Paid' },
  COMPLETED: { color: '#16A34A', bgColor: 'bg-green-100 dark:bg-green-900/30', icon: CheckCircle, label: 'Completed' },
  FAILED: { color: '#DC2626', bgColor: 'bg-red-100 dark:bg-red-900/30', icon: XCircle, label: 'Failed' },
  REFUNDED: { color: '#2563EB', bgColor: 'bg-blue-100 dark:bg-blue-900/30', icon: Truck, label: 'Refunded' },
};

const SC_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  COMPLETED: { color: '#16A34A', label: 'Rewarded' },
  PENDING: { color: '#FF8A2A', label: 'Processing' },
  FAILED: { color: '#DC2626', label: 'Failed' },
};

export default function OrderDetailHybrid({ orderId }: OrderDetailHybridProps) {
  const { user } = useAuth();
  const coin = useCoin();
  const [transaction, setTransaction] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTransaction();
  }, [orderId]);

  const loadTransaction = async () => {
    if (!user?.id || !user?.walletAddress || !orderId) return;
    try {
      setLoading(true);
      const result = await api.getCommerceTransaction({
        transactionId: orderId,
        userId: user.id,
      }, user.walletAddress);
      setTransaction(result);
    } catch (error) {
      console.error('Failed to load transaction:', error);
      Alert.alert('Error', 'Failed to load order details');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-slate-950">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#f97316" />
        </View>
      </SafeAreaView>
    );
  }

  if (!transaction) {
    return (
      <SafeAreaView className="flex-1 bg-slate-950">
        <View className="flex-1 items-center justify-center p-6">
          <AlertCircle size={48} color="#DC2626" />
          <Text className="text-white text-lg font-semibold mt-4">Order Not Found</Text>
          <TouchableOpacity
            onPress={() => router.back()}
            className="mt-6 bg-orange-600 px-6 py-3 rounded-xl"
          >
            <Text className="text-white font-semibold">Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const config = STATUS_CONFIG[transaction.status] || STATUS_CONFIG.PENDING;
  const StatusIcon = config.icon;
  const orderDate = new Date(transaction.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const scReward = transaction.scMintEvents?.[0] ?? null;
  const scConfig = scReward ? SC_STATUS_CONFIG[scReward.status] : null;

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      {/* Header */}
      <View className="flex-row items-center justify-between px-6 py-4 border-b border-gray-800">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 items-center justify-center rounded-full bg-gray-800"
        >
          <ArrowLeft size={20} color="#fff" />
        </TouchableOpacity>
        <Text className="text-white text-lg font-semibold">Order Details</Text>
        <View className="w-10" />
      </View>

      <ScrollView className="flex-1">
        {/* Status Card */}
        <View className="px-6 py-4">
          <View className="bg-gray-800 rounded-2xl p-4">
            <View className="flex-row items-center justify-between mb-2">
              <View className={`px-3 py-1.5 rounded-full ${config.bgColor}`}>
                <View className="flex-row items-center">
                  <StatusIcon size={14} color={config.color} />
                  <Text className="ml-1.5 font-semibold" style={{ color: config.color }}>
                    {config.label}
                  </Text>
                </View>
              </View>
              <Text className="text-gray-400 text-sm">{orderDate}</Text>
            </View>
            <Text className="text-white text-2xl font-bold mt-2">
              ${transaction.chargedAmount.toFixed(2)}
            </Text>
            <Text className="text-gray-400 text-sm mt-1">
              Order #{transaction.id.slice(0, 8)}
            </Text>
          </View>
        </View>

        {/* Store Info */}
        <View className="px-6 py-2">
          <Text className="text-gray-400 text-xs font-semibold uppercase mb-2">Store</Text>
          <View className="bg-gray-800 rounded-xl p-4 flex-row items-center">
            <View className="w-12 h-12 rounded-lg bg-gray-700 items-center justify-center">
              <Package size={20} color="#9CA3AF" />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-white font-semibold">{transaction.business.name}</Text>
              <Text className="text-gray-400 text-sm">Hybrid commerce payment</Text>
            </View>
          </View>
        </View>

        {/* Payment Breakdown */}
        <View className="px-6 py-2">
          <Text className="text-gray-400 text-xs font-semibold uppercase mb-2">Payment Details</Text>
          <View className="bg-gray-800 rounded-xl p-4">
            <View className="flex-row justify-between mb-2">
              <Text className="text-gray-400">Subtotal</Text>
              <Text className="text-white font-semibold">${transaction.listedAmount.toFixed(2)}</Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-gray-400">Platform Fee</Text>
              <Text className="text-white font-semibold">
                ${(transaction.chargedAmount - transaction.listedAmount).toFixed(2)}
              </Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-gray-400">Wealth Fund Contribution</Text>
              <Text className="text-white font-semibold">${transaction.treasuryFeeAmount.toFixed(2)}</Text>
            </View>
            <View className="h-px bg-gray-700 my-2" />
            <View className="flex-row justify-between mb-2">
              <Text className="text-white font-semibold">Total Charged</Text>
              <Text className="text-white font-bold text-lg">${transaction.chargedAmount.toFixed(2)}</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-gray-400 text-sm">Merchant Received</Text>
              <Text className="text-gray-300 text-sm">${transaction.merchantSettlementAmount.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* Coin Reward Status */}
        {scReward ? (
          <View className="px-6 py-2">
            <Text className="text-gray-400 text-xs font-semibold uppercase mb-2">{coin.symbol} Rewards</Text>
            <View className="bg-gray-800 rounded-xl p-4">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-white font-semibold">Status</Text>
                <View className={`px-3 py-1 rounded-full ${
                  scReward.status === 'COMPLETED' ? 'bg-green-900/30' :
                  scReward.status === 'PENDING' ? 'bg-amber-900/30' : 'bg-red-900/30'
                }`}>
                  <Text className="font-semibold" style={{ color: scConfig?.color }}>
                    {scConfig?.label}
                  </Text>
                </View>
              </View>
              <View className="flex-row justify-between mb-2">
                <Text className="text-gray-400">Requested Amount</Text>
                <Text className="text-white font-semibold">{scReward.requestedAmount} {coin.symbol}</Text>
              </View>
              {scReward.status === 'COMPLETED' && (
                <>
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-gray-400">Mint Requested</Text>
                    <Text className="text-white font-semibold">{scReward.requestedAmount} {coin.symbol}</Text>
                  </View>
                </>
              )}
              {scReward.status === 'PENDING' && (
                <View className="mt-2 p-3 bg-amber-900/20 rounded-lg">
                  <Text className="text-amber-400 text-sm">
                    Your {coin.symbol} reward is being processed on-chain. This may take a few minutes.
                  </Text>
                </View>
              )}
              {scReward.status === 'FAILED' && (
                <View className="mt-2 p-3 bg-red-900/20 rounded-lg">
                  <Text className="text-red-400 text-sm">
                    The {coin.symbol} mint did not complete. This payment succeeded, but the reward may need follow-up.
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <View className="px-6 py-2">
            <View className="bg-gray-800 rounded-xl p-4">
              <View className="flex-row items-center">
                <AlertCircle size={18} color="#9CA3AF" />
                <Text className="text-gray-400 text-sm ml-2">
                  This merchant is not yet eligible for {coin.symbol} rewards
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Shipping Address */}
        {transaction.shippingAddress && (
          <View className="px-6 py-2">
            <Text className="text-gray-400 text-xs font-semibold uppercase mb-2">Shipping Address</Text>
            <View className="bg-gray-800 rounded-xl p-4 flex-row">
              <MapPin size={18} color="#9CA3AF" />
              <Text className="text-white ml-3 flex-1">{transaction.shippingAddress}</Text>
            </View>
          </View>
        )}

        {/* Tracking Number */}
        {transaction.trackingNumber && (
          <View className="px-6 py-2">
            <Text className="text-gray-400 text-xs font-semibold uppercase mb-2">Tracking</Text>
            <View className="bg-gray-800 rounded-xl p-4">
              <Text className="text-white font-mono">{transaction.trackingNumber}</Text>
            </View>
          </View>
        )}

        {/* Note */}
        {transaction.note && (
          <View className="px-6 py-2">
            <Text className="text-gray-400 text-xs font-semibold uppercase mb-2">Note</Text>
            <View className="bg-gray-800 rounded-xl p-4">
              <Text className="text-white">{transaction.note}</Text>
            </View>
          </View>
        )}

        {/* Transaction ID */}
        <View className="px-6 py-2 mb-6">
          <Text className="text-gray-400 text-xs font-semibold uppercase mb-2">Transaction ID</Text>
          <View className="bg-gray-800 rounded-xl p-4">
            <Text className="text-gray-300 text-xs font-mono">{transaction.id}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
