import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { router, Stack } from 'expo-router';
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, ChevronRight, Clock, Heart, Home, Briefcase, Store } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { friendlyError } from '@/lib/friendly-error';

type TransferType = 'PERSONAL' | 'RENT' | 'SERVICE' | 'STORE';

const TRANSFER_TYPE_CONFIG: Record<TransferType, { label: string; icon: any; color: string }> = {
  PERSONAL: { label: 'Personal', icon: Heart, color: '#EC4899' },
  RENT: { label: 'Rent', icon: Home, color: '#8B5CF6' },
  SERVICE: { label: 'Service', icon: Briefcase, color: '#3B82F6' },
  STORE: { label: 'Store', icon: Store, color: '#10B981' },
};

interface Transaction {
  id: string;
  type: 'sent' | 'received' | 'pending';
  amount: number;
  counterparty: string;
  status: string;
  note?: string;
  createdAt: string;
  transferType?: TransferType;
}

export default function HistoryScreen() {
  const { user, sessionToken } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // Kept apart from "no transactions" so a failed load never looks like an empty history.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(user?.walletAddress || null);

  useEffect(() => {
    if (user?.id) {
      initAndLoad();
    }
  }, [user?.id]);

  const initAndLoad = async () => {
    if (!user?.id) return;

    // Get wallet address if not in session
    let currentWalletAddress = user.walletAddress;
    if (!currentWalletAddress) {
      try {
        const walletResult = await api.getWalletInfo(user.id, user.walletAddress, sessionToken);
        if (walletResult?.hasWallet && walletResult?.address) {
          currentWalletAddress = walletResult.address;
          setWalletAddress(currentWalletAddress);
        }
      } catch (err) {
        console.error('Error getting wallet info:', err);
      }
    }

    await loadTransactions(0, currentWalletAddress);
  };

  const loadTransactions = async (offset = 0, walletAddr?: string | null) => {
    if (!user?.id) return;

    const addressToUse = walletAddr || walletAddress || user.walletAddress;

    try {
      const result = await api.getP2PHistory(user.id, 20, offset, addressToUse);
      const transfers: Transaction[] = result?.transfers ?? [];
      if (offset === 0) {
        setTransactions(transfers);
        setLoadError(null);
      } else {
        setTransactions((prev) => [...prev, ...transfers]);
      }
      setMoreError(null);
      setHasMore(transfers.length === 20);
    } catch (err) {
      console.error('Error loading history:', err);
      if (offset === 0) {
        setLoadError(friendlyError(err, "We couldn't load your transactions."));
      } else {
        setMoreError(friendlyError(err, "We couldn't load more transactions."));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadTransactions(0, walletAddress);
  }, [user?.id, walletAddress]);

  const loadMore = () => {
    if (loadingMore || !hasMore || moreError) return;
    setLoadingMore(true);
    loadTransactions(transactions.length, walletAddress);
  };

  const retryLoad = () => {
    setLoading(true);
    setLoadError(null);
    initAndLoad();
  };

  const retryMore = () => {
    setMoreError(null);
    setLoadingMore(true);
    loadTransactions(transactions.length, walletAddress);
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/wallet' as any);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'long' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const getStatusText = (tx: Transaction) => {
    if (tx.type === 'pending') {
      if (tx.status === 'PENDING_CLAIM') return 'Pending claim';
      if (tx.status === 'EXPIRED') return 'Expired';
      if (tx.status === 'CLAIMED_TO_BANK' || tx.status === 'CLAIMED_TO_SOULAAN') return 'Claimed';
    }
    if (tx.status === 'COMPLETED') return undefined;
    if (tx.status === 'FAILED') return 'Failed';
    if (tx.status === 'PROCESSING') return 'Processing';
    return undefined;
  };

  const renderTransaction = ({ item: tx }: { item: Transaction }) => {
    const statusText = getStatusText(tx);
    const transferTypeConfig = tx.transferType ? TRANSFER_TYPE_CONFIG[tx.transferType] : null;
    const TransferIcon = transferTypeConfig?.icon;

    const direction = tx.type === 'received' ? 'Received' : 'Paid';
    const preposition = tx.type === 'received' ? 'from' : 'to';
    const rowLabel = `${direction} $${tx.amount.toFixed(2)} ${preposition} ${tx.counterparty}, ${formatDate(tx.createdAt)}${
      statusText ? `, ${statusText}` : ''
    }. Opens the receipt.`;

    return (
      <TouchableOpacity
        onPress={() => openReceipt(tx.id)}
        accessibilityRole="button"
        accessibilityLabel={rowLabel}
        activeOpacity={0.7}
        className="flex-row items-center p-4 bg-white border-b border-gray-100"
        style={{ minHeight: 64 }}
      >
        <View
          className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
            tx.type === 'received'
              ? 'bg-green-100'
              : tx.type === 'pending'
              ? 'bg-yellow-100'
              : 'bg-gray-100'
          }`}
        >
          {tx.type === 'received' ? (
            <ArrowDownLeft size={20} color="#16A34A" />
          ) : tx.type === 'pending' ? (
            <Clock size={20} color="#CA8A04" />
          ) : (
            <ArrowUpRight size={20} color="#6B7280" />
          )}
        </View>

        <View className="flex-1">
          <View className="flex-row items-center">
            <Text className="text-gray-900 font-medium">{tx.counterparty}</Text>
            {/* Transfer Type Badge */}
            {transferTypeConfig && TransferIcon && (
              <View
                className="flex-row items-center ml-2 px-2 py-0.5 rounded-full"
                style={{ backgroundColor: `${transferTypeConfig.color}15` }}
              >
                <TransferIcon size={10} color={transferTypeConfig.color} />
                <Text
                  className="text-xs ml-1 font-medium"
                  style={{ color: transferTypeConfig.color }}
                >
                  {transferTypeConfig.label}
                </Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center">
            <Text className="text-gray-500 text-xs">{formatDate(tx.createdAt)}</Text>
            {statusText && (
              <>
                <Text className="text-gray-300 text-xs mx-1">•</Text>
                <Text
                  className={`text-xs ${
                    tx.status === 'FAILED' || tx.status === 'EXPIRED'
                      ? 'text-red-500'
                      : tx.status === 'PENDING_CLAIM'
                      ? 'text-yellow-600'
                      : 'text-gray-500'
                  }`}
                >
                  {statusText}
                </Text>
              </>
            )}
          </View>
          {tx.note && (
            <Text className="text-gray-400 text-xs mt-1">&quot;{tx.note}&quot;</Text>
          )}
        </View>

        <Text
          className={`font-semibold ${
            tx.type === 'received'
              ? 'text-green-600'
              : tx.status === 'FAILED' || tx.status === 'EXPIRED'
              ? 'text-gray-400'
              : 'text-gray-900'
          }`}
        >
          {tx.type === 'received' ? '+' : '-'}${tx.amount.toFixed(2)}
        </Text>
        <ChevronRight size={18} color="#9CA3AF" style={{ marginLeft: 6 }} />
      </TouchableOpacity>
    );
  };

  const openReceipt = (id: string) => {
    router.push({ pathname: '/(authenticated)/receipt', params: { id } } as any);
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
      <View className="flex-1 bg-gray-50">
        {/* Header */}
        <View className="pt-14 pb-4 px-4 bg-white border-b border-gray-100 flex-row items-center">
          <TouchableOpacity
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            className="items-center justify-center mr-2"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <ArrowLeft size={24} color="#111827" />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-2xl font-bold text-gray-900">History</Text>
            <Text className="text-sm text-gray-500 mt-1">Your recent transactions</Text>
            {transactions.length > 0 ? (
              <Text className="text-sm text-gray-500">Tap a payment to see its receipt.</Text>
            ) : null}
          </View>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#6B7280" />
          </View>
        ) : loadError && transactions.length === 0 ? (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-gray-900 text-lg font-semibold text-center">
              Your history didn&apos;t load
            </Text>
            <Text className="text-gray-600 text-center mt-2">{loadError}</Text>
            <TouchableOpacity
              onPress={retryLoad}
              accessibilityRole="button" accessibilityLabel="Try again"
              className="mt-6 bg-primary px-6 py-3 rounded-xl items-center justify-center"
              style={{ minHeight: 48 }}
            >
              <Text className="text-white font-semibold">Try again</Text>
            </TouchableOpacity>
          </View>
        ) : transactions.length === 0 ? (
          <View className="flex-1 items-center justify-center p-8">
            <Clock size={48} color="#9CA3AF" />
            <Text className="text-gray-500 text-lg mt-4">No transactions yet</Text>
            <Text className="text-gray-400 text-center mt-2">
              Payments you make or receive will show up here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={transactions}
            renderItem={renderTransaction}
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            ListHeaderComponent={
              loadError ? (
                <View className="m-4 p-4 rounded-xl bg-red-50 border border-red-100">
                  <Text className="text-red-800">{loadError}</Text>
                  <TouchableOpacity
                    onPress={onRefresh}
                    accessibilityRole="button" accessibilityLabel="Try again"
                    className="mt-2 self-start bg-white px-4 rounded-xl items-center justify-center border border-red-200"
                    style={{ minHeight: 44 }}
                  >
                    <Text className="text-red-800 font-semibold">Try again</Text>
                  </TouchableOpacity>
                </View>
              ) : null
            }
            ListFooterComponent={
              loadingMore ? (
                <View className="py-4">
                  <ActivityIndicator size="small" color="#6B7280" />
                </View>
              ) : moreError ? (
                <View className="p-4 items-center">
                  <Text className="text-gray-600 text-center">{moreError}</Text>
                  <TouchableOpacity
                    onPress={retryMore}
                    accessibilityRole="button" accessibilityLabel="Try again"
                    className="mt-2 bg-gray-900 px-6 rounded-xl items-center justify-center"
                    style={{ minHeight: 44 }}
                  >
                    <Text className="text-white font-semibold">Try again</Text>
                  </TouchableOpacity>
                </View>
              ) : null
            }
          />
        )}
      </View>
    </>
  );
}
