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
import {
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  DollarSign,
} from 'lucide-react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface PaymentRequest {
  id: string;
  token: string;
  amount: number | null;
  description: string | null;
  referenceId: string | null;
  status: string;
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

type FilterStatus = 'ALL' | 'PENDING' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: any }> = {
  PENDING: { label: 'Pending', color: '#CA8A04', bgColor: 'bg-yellow-100', icon: Clock },
  COMPLETED: { label: 'Paid', color: '#16A34A', bgColor: 'bg-green-100', icon: CheckCircle },
  EXPIRED: { label: 'Expired', color: '#6B7280', bgColor: 'bg-gray-100', icon: AlertCircle },
  CANCELLED: { label: 'Cancelled', color: '#DC2626', bgColor: 'bg-red-100', icon: XCircle },
};

export default function StorePaymentsScreen() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('ALL');

  useEffect(() => {
    loadRequests(true);
  }, [filter]);

  const loadRequests = async (reset = false) => {
    if (!user?.walletAddress) return;

    try {
      if (reset) {
        setLoading(true);
      }

      const result = await api.getMyPaymentRequests(
        filter === 'ALL' ? undefined : filter,
        50,
        reset ? undefined : nextCursor || undefined,
        user.walletAddress
      );

      if (reset) {
        setRequests(result.requests);
      } else {
        setRequests(prev => [...prev, ...result.requests]);
      }
      setNextCursor(result.nextCursor);
    } catch (err) {
      console.error('Error loading payment requests:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadRequests(true);
  }, [filter]);

  const loadMore = () => {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    loadRequests(false);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const renderRequest = ({ item }: { item: PaymentRequest }) => {
    const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.PENDING;
    const StatusIcon = config.icon;

    return (
      <View className="flex-row items-center p-4 bg-white border-b border-gray-100">
        <View className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${config.bgColor}`}>
          <StatusIcon size={20} color={config.color} />
        </View>

        <View className="flex-1">
          <View className="flex-row items-center">
            {item.amount !== null ? (
              <Text className="text-gray-900 font-semibold">
                ${item.amount.toFixed(2)}
              </Text>
            ) : (
              <Text className="text-gray-500 italic">Any amount</Text>
            )}
            <View
              className="ml-2 px-2 py-0.5 rounded-full"
              style={{ backgroundColor: `${config.color}20` }}
            >
              <Text className="text-xs font-medium" style={{ color: config.color }}>
                {config.label}
              </Text>
            </View>
          </View>

          {item.description && (
            <Text className="text-gray-500 text-sm" numberOfLines={1}>
              {item.description}
            </Text>
          )}

          <Text className="text-gray-400 text-xs mt-1">
            {item.paidAt ? `Paid ${formatDate(item.paidAt)}` : formatDate(item.createdAt)}
          </Text>
        </View>

        {item.status === 'COMPLETED' && item.amount !== null && (
          <Text className="text-green-600 font-semibold">
            +${item.amount.toFixed(2)}
          </Text>
        )}
      </View>
    );
  };

  const FilterButton = ({ status, label }: { status: FilterStatus; label: string }) => (
    <TouchableOpacity
      onPress={() => setFilter(status)}
      className={`px-4 py-2 rounded-full mr-2 ${
        filter === status ? 'bg-primary' : 'bg-gray-100'
      }`}
    >
      <Text
        className={`font-medium ${filter === status ? 'text-white' : 'text-gray-600'}`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-gray-50">
        {/* Header */}
        <View className="pt-14 pb-4 px-4 bg-white border-b border-gray-100">
          <View className="flex-row items-center mb-4">
            <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
              <ArrowLeft size={24} color="#111827" />
            </TouchableOpacity>
            <Text className="flex-1 text-center text-lg font-semibold text-gray-900">
              Payment Requests
            </Text>
            <View className="w-10" />
          </View>

          {/* Filter Tabs */}
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={[
              { status: 'ALL' as FilterStatus, label: 'All' },
              { status: 'PENDING' as FilterStatus, label: 'Pending' },
              { status: 'COMPLETED' as FilterStatus, label: 'Paid' },
              { status: 'EXPIRED' as FilterStatus, label: 'Expired' },
            ]}
            keyExtractor={(item) => item.status}
            renderItem={({ item }) => (
              <FilterButton status={item.status} label={item.label} />
            )}
          />
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#FF8A2A" />
          </View>
        ) : requests.length === 0 ? (
          <View className="flex-1 items-center justify-center p-8">
            <DollarSign size={48} color="#9CA3AF" />
            <Text className="text-gray-500 text-lg mt-4 text-center">
              No payment requests yet
            </Text>
            <Text className="text-gray-400 text-center mt-2">
              Create a payment request to start accepting payments
            </Text>
            <TouchableOpacity
              onPress={() => router.back()}
              className="mt-6 bg-primary px-6 py-3 rounded-xl"
            >
              <Text className="text-white font-semibold">Create Request</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={requests}
            renderItem={renderRequest}
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              loadingMore ? (
                <View className="py-4">
                  <ActivityIndicator size="small" color="#FF8A2A" />
                </View>
              ) : null
            }
          />
        )}
      </View>
    </>
  );
}
