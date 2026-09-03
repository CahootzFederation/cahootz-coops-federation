import { View, Text, ScrollView, RefreshControl, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { api } from '~/lib/api';
import { useAuth } from '~/contexts/auth-context';

interface Transfer {
  id: string;
  type: 'sent' | 'received' | 'pending';
  amount: number;
  counterparty: string;
  status: string;
  note?: string;
  createdAt: string;
}

export default function HistoryScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      setError(null);

      // Get P2P transfer history
      const history = await api.getP2PHistory(user.id, 50, 0, user.walletAddress);
      setTransfers(history.transfers || []);
    } catch (err) {
      console.error('Error loading history:', err);
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, user?.walletAddress]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadHistory();
  }, [loadHistory]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'long' }) + ' ' +
        date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString() + ' ' +
        date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'text-green-600';
      case 'PENDING':
      case 'PROCESSING':
      case 'PENDING_CLAIM':
        return 'text-primary';
      case 'FAILED':
      case 'EXPIRED':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'Completed';
      case 'PENDING':
        return 'Pending';
      case 'PROCESSING':
        return 'Processing';
      case 'PENDING_CLAIM':
        return 'Awaiting claim';
      case 'FAILED':
        return 'Failed';
      case 'EXPIRED':
        return 'Expired';
      case 'CLAIMED_TO_BANK':
        return 'Claimed to bank';
      case 'CLAIMED_TO_SOULAAN':
        return 'Claimed';
      default:
        return status;
    }
  };

  const getTransferIcon = (type: string) => {
    switch (type) {
      case 'sent':
        return '↑';
      case 'received':
        return '↓';
      case 'pending':
        return '⏳';
      default:
        return '•';
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#FF8A2A" />
        <Text className="mt-4 text-gray-600">Loading history...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-6">
        <Text className="text-lg text-red-600 mb-4">Error</Text>
        <Text className="text-center text-gray-600 mb-6">{error}</Text>
        <TouchableOpacity
          onPress={loadHistory}
          className="bg-primary px-6 py-3 rounded-lg"
        >
          <Text className="text-white font-semibold">Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View className="p-4">
        <Text className="text-2xl font-bold text-gray-900 mb-4">Activity</Text>

        {transfers.length === 0 ? (
          <View className="bg-white rounded-xl p-8 items-center">
            <Text className="text-4xl mb-4">💸</Text>
            <Text className="text-gray-900 font-semibold text-lg mb-2">No activity yet</Text>
            <Text className="text-gray-500 text-center">
              Your payments will appear here once you send or receive money.
            </Text>
          </View>
        ) : (
          <View className="space-y-3">
            {transfers.map((transfer) => {
              const isSent = transfer.type === 'sent' || transfer.type === 'pending';

              return (
                <View
                  key={transfer.id}
                  className="bg-white rounded-xl p-4 shadow-sm"
                >
                  {/* Header: Icon, Name, Amount */}
                  <View className="flex-row items-center">
                    {/* Icon */}
                    <View className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
                      transfer.type === 'received' ? 'bg-green-100' :
                      transfer.type === 'pending' ? 'bg-secondary' : 'bg-gray-100'
                    }`}>
                      <Text className={`text-lg ${
                        transfer.type === 'received' ? 'text-green-600' :
                        transfer.type === 'pending' ? 'text-primary' : 'text-gray-600'
                      }`}>
                        {getTransferIcon(transfer.type)}
                      </Text>
                    </View>

                    {/* Name and status */}
                    <View className="flex-1">
                      <Text className="text-gray-900 font-semibold">
                        {transfer.counterparty}
                      </Text>
                      <Text className={`text-sm ${getStatusColor(transfer.status)}`}>
                        {getStatusText(transfer.status)}
                      </Text>
                    </View>

                    {/* Amount */}
                    <Text
                      className={`text-lg font-bold ${
                        isSent ? 'text-gray-900' : 'text-green-600'
                      }`}
                    >
                      {isSent ? '-' : '+'}${transfer.amount.toFixed(2)}
                    </Text>
                  </View>

                  {/* Note if present */}
                  {transfer.note && (
                    <View className="mt-3 bg-gray-50 rounded-lg p-2">
                      <Text className="text-gray-600 text-sm">
                        &quot;{transfer.note}&quot;
                      </Text>
                    </View>
                  )}

                  {/* Timestamp */}
                  <Text className="text-gray-400 text-xs mt-2">
                    {formatDate(transfer.createdAt)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
