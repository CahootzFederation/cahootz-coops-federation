import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ArrowLeft,
  ShoppingBag,
  Package,
  Truck,
  CheckCircle,
  XCircle,
  Clock,
  CreditCard,
  ChevronRight,
  AlertCircle,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { useCoin } from '@/contexts/platform-config-context';
import { api } from '@/lib/api';

const STATUS_CONFIG: Record<string, { color: string; bgColor: string; icon: any; label: string }> = {
  PENDING: { color: '#FF8A2A', bgColor: 'bg-secondary dark:bg-amber-900/30', icon: Clock, label: 'Pending' },
  PROCESSING: { color: '#2563EB', bgColor: 'bg-blue-100 dark:bg-blue-900/30', icon: CreditCard, label: 'Paid' },
  COMPLETED: { color: '#16A34A', bgColor: 'bg-green-100 dark:bg-green-900/30', icon: CheckCircle, label: 'Completed' },
  FAILED: { color: '#DC2626', bgColor: 'bg-red-100 dark:bg-red-900/30', icon: XCircle, label: 'Failed' },
  REFUNDED: { color: '#2563EB', bgColor: 'bg-blue-100 dark:bg-blue-900/30', icon: Truck, label: 'Refunded' },
};

interface OrderCardProps {
  transaction: any;
  onPress: () => void;
}

function OrderCard({ transaction, onPress }: OrderCardProps) {
  const coin = useCoin();
  const config = STATUS_CONFIG[transaction.status] || STATUS_CONFIG.PENDING;
  const StatusIcon = config.icon;
  const orderDate = new Date(transaction.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const scReward = transaction.scMintEvents?.[0] ?? null;
  const hasScMismatch = scReward && (scReward.status === 'FAILED' || scReward.status === 'PENDING');

  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-gray-800 rounded-xl p-4 mb-3"
    >
      {/* Header - Store & Status */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center flex-1">
          <View className="w-10 h-10 rounded-lg bg-gray-700 items-center justify-center">
            <ShoppingBag size={18} color="#9CA3AF" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-white font-semibold">{transaction.business.name}</Text>
            <Text className="text-gray-400 text-xs">{orderDate}</Text>
          </View>
        </View>
        <View className={`px-3 py-1 rounded-full ${config.bgColor}`}>
          <View className="flex-row items-center">
            <StatusIcon size={12} color={config.color} />
            <Text className="ml-1 text-xs font-semibold" style={{ color: config.color }}>
              {config.label}
            </Text>
          </View>
        </View>
      </View>

      {/* Amount & SC Status */}
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-white text-xl font-bold">${transaction.chargedAmount.toFixed(2)}</Text>
          <Text className="text-gray-400 text-xs">
            {transaction.metadata?.itemCount || 0} item(s)
          </Text>
        </View>
        <View className="flex-row items-center">
          {scReward ? (
            <View className="flex-row items-center">
              {scReward.status === 'COMPLETED' && (
                <>
                  <CheckCircle size={14} color="#16A34A" />
                  <Text className="text-green-400 text-sm ml-1 font-semibold">
                    +SC
                  </Text>
                </>
              )}
              {scReward.status === 'PENDING' && (
                <>
                  <Clock size={14} color="#FF8A2A" />
                  <Text className="text-amber-400 text-sm ml-1 font-semibold">SC Pending</Text>
                </>
              )}
              {scReward.status === 'FAILED' && (
                <>
                  <AlertCircle size={14} color="#DC2626" />
                  <Text className="text-red-400 text-sm ml-1 font-semibold">{coin.symbol} Failed</Text>
                </>
              )}
            </View>
          ) : (
            <Text className="text-gray-500 text-xs">No {coin.symbol} rewards</Text>
          )}
          <ChevronRight size={18} color="#9CA3AF" className="ml-2" />
        </View>
      </View>

      {/* Mismatch Alert */}
      {hasScMismatch && (
        <View className="mt-3 p-2 bg-amber-900/20 rounded-lg flex-row items-center">
          <AlertCircle size={14} color="#FF8A2A" />
          <Text className="text-amber-400 text-xs ml-2">
            {scReward.status === 'PENDING' 
              ? 'SC reward processing...' 
              : 'SC reward failed - contact support'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function OrdersListHybrid() {
  const { user } = useAuth();
  const coin = useCoin();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadTransactions = useCallback(async () => {
    if (!user?.id || !user?.walletAddress) return;
    try {
      const result = await api.listCommerceTransactions({
        userId: user.id,
        customerId: user.id,
        limit: 50,
      }, user.walletAddress);
      setTransactions(result.transactions);
    } catch (error) {
      console.error('Failed to load orders:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadTransactions();
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
        <Text className="text-white text-lg font-semibold">My Orders</Text>
        <View className="w-10" />
      </View>

      {/* Orders List */}
      <ScrollView
        className="flex-1 px-6 py-4"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#f97316" />
        }
      >
        {transactions.length === 0 ? (
          <View className="flex-1 items-center justify-center py-20">
            <ShoppingBag size={64} color="#4B5563" />
            <Text className="text-gray-400 text-lg font-semibold mt-4">No Orders Yet</Text>
            <Text className="text-gray-500 text-sm mt-2 text-center px-6">
              Your order history will appear here after you make your first purchase
            </Text>
          </View>
        ) : (
          <>
            {transactions.map((transaction) => (
              <OrderCard
                key={transaction.id}
                transaction={transaction}
                onPress={() => router.push(`/order-detail?id=${transaction.id}`)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
