import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Package,
  Clock,
  Truck,
  CheckCircle,
  XCircle,
  ChevronRight,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

interface Order {
  id: string;
  totalUSD: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  itemCount: number;
  itemSummary: string;
  shippingAddress: string | null;
  createdAt: string;
}

type FilterStatus = 'ALL' | 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export default function StoreOrdersScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams();
  const storeId = params.storeId as string | undefined;
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<FilterStatus>('ALL');

  const loadOrders = useCallback(async () => {
    if (!user?.walletAddress) return;
    try {
      const options = selectedStatus === 'ALL' ? { storeId } : { status: selectedStatus, storeId };
      console.log('Loading orders with filter:', options);
      const result = await api.getStoreOrders(user.walletAddress, options);
      console.log(`Loaded ${result.orders?.length || 0} orders`);
      setOrders(result.orders || []);
    } catch (error) {
      console.error('Failed to load orders:', error);
      setOrders([]);
    }
  }, [user?.walletAddress, selectedStatus, storeId]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadOrders();
      setLoading(false);
    };
    init();
  }, [loadOrders]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  };

  const formatPrice = (price: number) => {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Clock size={16} color="#CA8A04" />;
      case 'PROCESSING':
        return <Package size={16} color="#3B82F6" />;
      case 'SHIPPED':
        return <Truck size={16} color="#8B5CF6" />;
      case 'DELIVERED':
        return <CheckCircle size={16} color="#10B981" />;
      case 'CANCELLED':
        return <XCircle size={16} color="#DC2626" />;
      default:
        return <Package size={16} color="#9CA3AF" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-700';
      case 'PROCESSING':
        return 'bg-blue-100 text-blue-700';
      case 'SHIPPED':
        return 'bg-purple-100 text-purple-700';
      case 'DELIVERED':
        return 'bg-green-100 text-green-700';
      case 'CANCELLED':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const statusFilters: { value: FilterStatus; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'PROCESSING', label: 'Processing' },
    { value: 'SHIPPED', label: 'Shipped' },
    { value: 'DELIVERED', label: 'Delivered' },
    { value: 'CANCELLED', label: 'Cancelled' },
  ];

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#FF6B00" />
          <Text className="text-gray-500 mt-4">Loading orders...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 bg-white border-b border-gray-200">
        <TouchableOpacity onPress={() => router.back()}>
          <ArrowLeft size={24} color="#374151" />
        </TouchableOpacity>
        <Text className="text-lg font-semibold text-gray-900">Store Orders</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Status Filters */}
      <View className="bg-white border-b border-gray-200 px-5 py-3">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {statusFilters.map((filter) => (
            <TouchableOpacity
              key={filter.value}
              onPress={() => setSelectedStatus(filter.value)}
              className={`px-4 py-2 rounded-lg border ${
                selectedStatus === filter.value
                  ? 'bg-primary border-amber-600'
                  : 'bg-white border-gray-300'
              }`}
              style={{ minWidth: filter.value === 'ALL' ? 60 : undefined }}
            >
              <Text
                className={`text-sm font-semibold ${
                  selectedStatus === filter.value ? 'text-white' : 'text-gray-700'
                }`}
                numberOfLines={1}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B00" />
        }
        showsVerticalScrollIndicator={false}
      >
        <View className="p-5">
          {orders.length === 0 ? (
            <View className="bg-white rounded-2xl p-12 items-center">
              <Package size={64} color="#D1D5DB" />
              <Text className="text-gray-500 text-center mt-4 text-lg font-semibold">
                No Orders Yet
              </Text>
              <Text className="text-gray-400 text-center mt-2">
                {selectedStatus === 'ALL' 
                  ? "Orders from customers will appear here"
                  : `No ${statusFilters.find(f => f.value === selectedStatus)?.label.toLowerCase()} orders`}
              </Text>
            </View>
          ) : (
            orders.map((order) => (
              <TouchableOpacity
                key={order.id}
                onPress={() => router.push(`/order-detail?id=${order.id}`)}
                className="bg-white rounded-2xl mb-3 shadow-sm overflow-hidden"
              >
                <View className="p-4">
                  {/* Order Header */}
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-1">
                      <Text className="text-xs text-gray-500">Order #{order.id.slice(-8)}</Text>
                      <Text className="text-xs text-gray-400 mt-0.5">{formatDate(order.createdAt)}</Text>
                    </View>
                    <View className={`px-3 py-1 rounded-full flex-row items-center ${getStatusColor(order.fulfillmentStatus)}`}>
                      {getStatusIcon(order.fulfillmentStatus)}
                      <Text className={`text-xs font-medium ml-1 ${getStatusColor(order.fulfillmentStatus).split(' ')[1]}`}>
                        {order.fulfillmentStatus}
                      </Text>
                    </View>
                  </View>

                  {/* Order Details */}
                  <View className="mb-3">
                    <Text className="text-sm text-gray-600" numberOfLines={2}>
                      {order.itemSummary}
                      {order.itemCount > 2 && ` +${order.itemCount - 2} more`}
                    </Text>
                    <Text className="text-xs text-gray-400 mt-1">
                      {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                    </Text>
                  </View>

                  {/* Price & Action */}
                  <View className="flex-row items-center justify-between pt-3 border-t border-gray-100">
                    <Text className="text-lg font-bold text-primary">
                      ${formatPrice(order.totalUSD)}
                    </Text>
                    <View className="flex-row items-center">
                      <Text className="text-sm text-primary font-medium mr-1">View Details</Text>
                      <ChevronRight size={16} color="#FF8A2A" />
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
