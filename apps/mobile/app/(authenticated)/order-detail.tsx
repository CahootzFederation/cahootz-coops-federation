import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
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
  MapPin,
  User,
  Edit3,
  X,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import OrderDetailHybrid from '@/components/order-detail-hybrid';

interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  productImage: string | null;
  quantity: number;
  priceUSD: number;
  totalUSD: number;
}

interface OrderDetail {
  id: string;
  subtotalUSD: number;
  discountUSD: number;
  totalUSD: number;
  paymentMethod: string;
  paymentStatus: string;
  transactionHash: string | null;
  fulfillmentStatus: string;
  shippingAddress: string | null;
  trackingNumber: string | null;
  note: string | null;
  store: {
    id: string;
    name: string;
    imageUrl: string | null;
  };
  items: OrderItem[];
  isBuyer: boolean;
  isStoreOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

type FulfillmentStatus = 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams();
  const { user } = useAuth();
  const [useHybrid, setUseHybrid] = useState<boolean | null>(null);

  // Check if hybrid architecture is enabled
  useEffect(() => {
    async function checkFeatureFlag() {
      try {
        const response = await fetch('http://localhost:3001/api/feature-flags/hybrid-architecture');
        const data = await response.json();
        setUseHybrid(data.enabled);
      } catch (error) {
        console.error('Failed to check feature flag:', error);
        setUseHybrid(false);
      }
    }
    checkFeatureFlag();
  }, []);

  if (useHybrid === null) {
    return (
      <SafeAreaView className="flex-1 bg-slate-950">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#f97316" />
        </View>
      </SafeAreaView>
    );
  }

  if (useHybrid && id) {
    return <OrderDetailHybrid orderId={id as string} />;
  }

  return <OrderDetailLegacyScreen orderId={id as string} />;
}

function OrderDetailLegacyScreen({ orderId }: { orderId: string }) {
  const { user } = useAuth();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<FulfillmentStatus>('PROCESSING');
  const [trackingNumber, setTrackingNumber] = useState('');

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  const loadOrder = async () => {
    if (!user?.walletAddress || !orderId) return;
    try {
      setLoading(true);
      const orderData = await api.getOrder(orderId, user.walletAddress);
      setOrder(orderData);
    } catch (error) {
      console.error('Failed to load order:', error);
      Alert.alert('Error', 'Failed to load order details');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!user?.walletAddress || !orderId) return;

    // Validate tracking number for shipped status
    if (selectedStatus === 'SHIPPED' && !trackingNumber.trim()) {
      Alert.alert('Tracking Required', 'Please enter a tracking number for shipped orders');
      return;
    }

    try {
      setUpdating(true);
      await api.updateOrderStatus(
        orderId,
        selectedStatus,
        trackingNumber.trim() || undefined,
        user.walletAddress
      );
      
      // Reload order to show updated status
      await loadOrder();
      setShowStatusModal(false);
      setTrackingNumber('');
      
      Alert.alert('Success', 'Order status updated successfully. Customer has been notified.');
    } catch (error: any) {
      console.error('Failed to update status:', error);
      Alert.alert('Error', error.message || 'Failed to update order status');
    } finally {
      setUpdating(false);
    }
  };

  const openStatusModal = () => {
    if (!order) return;
    setSelectedStatus(order.fulfillmentStatus as FulfillmentStatus);
    setTrackingNumber(order.trackingNumber || '');
    setShowStatusModal(true);
  };

  const formatPrice = (price: number) => {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Clock size={20} color="#CA8A04" />;
      case 'PROCESSING':
        return <Package size={20} color="#3B82F6" />;
      case 'SHIPPED':
        return <Truck size={20} color="#8B5CF6" />;
      case 'DELIVERED':
        return <CheckCircle size={20} color="#10B981" />;
      case 'CANCELLED':
        return <XCircle size={20} color="#DC2626" />;
      default:
        return <Package size={20} color="#9CA3AF" />;
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

  const statusOptions: { value: FulfillmentStatus; label: string; description: string }[] = [
    { value: 'PROCESSING', label: 'Processing', description: 'Order is being prepared' },
    { value: 'SHIPPED', label: 'Shipped', description: 'Order has been shipped (requires tracking)' },
    { value: 'DELIVERED', label: 'Delivered', description: 'Order has been delivered' },
    { value: 'CANCELLED', label: 'Cancelled', description: 'Order has been cancelled' },
  ];

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#FF6B00" />
          <Text className="text-gray-500 mt-4">Loading order...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-1 items-center justify-center">
          <Text className="text-gray-500">Order not found</Text>
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
        <Text className="text-lg font-semibold text-gray-900">Order Details</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="p-5">
          {/* Order Status Card */}
          <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
            <View className="flex-row items-center justify-between mb-3">
              <View>
                <Text className="text-xs text-gray-500">Order ID</Text>
                <Text className="font-mono text-sm text-gray-800">#{order.id.slice(-12)}</Text>
              </View>
              <View className={`px-3 py-2 rounded-full flex-row items-center ${getStatusColor(order.fulfillmentStatus)}`}>
                {getStatusIcon(order.fulfillmentStatus)}
                <Text className={`text-sm font-semibold ml-2 ${getStatusColor(order.fulfillmentStatus).split(' ')[1]}`}>
                  {order.fulfillmentStatus}
                </Text>
              </View>
            </View>
            
            <View className="border-t border-gray-100 pt-3 mb-3">
              <Text className="text-xs text-gray-500">Placed on</Text>
              <Text className="text-sm text-gray-800">{formatDate(order.createdAt)}</Text>
            </View>

            {/* Update Status Button (Store Owner Only) */}
            {order.isStoreOwner && order.fulfillmentStatus !== 'DELIVERED' && order.fulfillmentStatus !== 'CANCELLED' && (
              <TouchableOpacity
                onPress={openStatusModal}
                className="bg-primary py-3 rounded-xl flex-row items-center justify-center"
              >
                <Edit3 size={16} color="white" />
                <Text className="text-white font-semibold ml-2">Update Order Status</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Tracking Info */}
          {order.trackingNumber && (
            <View className="bg-purple-50 rounded-2xl p-4 mb-4 border border-purple-200">
              <View className="flex-row items-center mb-2">
                <Truck size={20} color="#8B5CF6" />
                <Text className="text-purple-900 font-semibold ml-2">Tracking Information</Text>
              </View>
              <Text className="text-purple-700 font-mono text-sm">{order.trackingNumber}</Text>
            </View>
          )}

          {/* Shipping Address */}
          {order.shippingAddress && (
            <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
              <View className="flex-row items-center mb-3">
                <MapPin size={20} color="#FF6B00" />
                <Text className="font-semibold text-gray-900 ml-2">Shipping Address</Text>
              </View>
              <Text className="text-gray-700 leading-6">{order.shippingAddress}</Text>
            </View>
          )}

          {/* Order Items */}
          <View className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
            <Text className="font-semibold text-gray-900 mb-3">Order Items ({order.items.length})</Text>
            {order.items.map((item, index) => (
              <View
                key={item.id}
                className={`flex-row py-3 ${index < order.items.length - 1 ? 'border-b border-gray-100' : ''}`}
              >
                <View className="w-16 h-16 bg-gray-100 rounded-lg mr-3 items-center justify-center">
                  <Package size={24} color="#9CA3AF" />
                </View>
                <View className="flex-1">
                  <Text className="font-medium text-gray-900" numberOfLines={2}>
                    {item.productName}
                  </Text>
                  <Text className="text-sm text-gray-500 mt-1">
                    Qty: {item.quantity} × ${formatPrice(item.priceUSD)}
                  </Text>
                </View>
                <Text className="font-semibold text-gray-900">
                  ${formatPrice(item.totalUSD)}
                </Text>
              </View>
            ))}
          </View>

          {/* Order Note */}
          {order.note && (
            <View className="bg-secondary rounded-2xl p-4 mb-4 border border-border">
              <Text className="font-semibold text-amber-900 mb-2">Customer Note</Text>
              <Text className="text-amber-800 text-sm">{order.note}</Text>
            </View>
          )}

          {/* Order Summary */}
          <View className="bg-white rounded-2xl p-4 shadow-sm">
            <Text className="font-semibold text-gray-900 mb-3">Order Summary</Text>
            <View className="space-y-2">
              <View className="flex-row justify-between py-2">
                <Text className="text-gray-600">Subtotal</Text>
                <Text className="text-gray-900">${formatPrice(order.subtotalUSD)}</Text>
              </View>
              {order.discountUSD > 0 && (
                <View className="flex-row justify-between py-2">
                  <Text className="text-green-600">Discount</Text>
                  <Text className="text-green-600">-${formatPrice(order.discountUSD)}</Text>
                </View>
              )}
              <View className="flex-row justify-between py-3 border-t border-gray-200">
                <Text className="font-bold text-gray-900 text-lg">Total</Text>
                <Text className="font-bold text-primary text-lg">${formatPrice(order.totalUSD)}</Text>
              </View>
              <View className="flex-row justify-between py-2 border-t border-gray-100">
                <Text className="text-sm text-gray-500">Payment Method</Text>
                <Text className="text-sm text-gray-700">{order.paymentMethod}</Text>
              </View>
              <View className="flex-row justify-between py-2">
                <Text className="text-sm text-gray-500">Payment Status</Text>
                <Text className="text-sm text-green-600 font-medium">{order.paymentStatus}</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Update Status Modal */}
      <Modal
        visible={showStatusModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStatusModal(false)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white rounded-t-3xl p-5" style={{ maxHeight: '80%' }}>
            {/* Modal Header */}
            <View className="flex-row items-center justify-between mb-5">
              <Text className="text-xl font-bold text-gray-900">Update Order Status</Text>
              <TouchableOpacity onPress={() => setShowStatusModal(false)}>
                <X size={24} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Status Options */}
              <View className="mb-5">
                <Text className="text-sm font-semibold text-gray-700 mb-3">Select New Status</Text>
                {statusOptions.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => setSelectedStatus(option.value)}
                    className={`p-4 rounded-xl mb-2 border-2 ${
                      selectedStatus === option.value
                        ? 'border-amber-600 bg-secondary'
                        : 'border-gray-200 bg-white'
                    }`}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1">
                        <Text className={`font-semibold ${
                          selectedStatus === option.value ? 'text-amber-900' : 'text-gray-900'
                        }`}>
                          {option.label}
                        </Text>
                        <Text className="text-sm text-gray-500 mt-1">{option.description}</Text>
                      </View>
                      {selectedStatus === option.value && (
                        <CheckCircle size={24} color="#FF8A2A" />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Tracking Number Input (for Shipped status) */}
              {selectedStatus === 'SHIPPED' && (
                <View className="mb-5">
                  <Text className="text-sm font-semibold text-gray-700 mb-2">
                    Tracking Number <Text className="text-red-500">*</Text>
                  </Text>
                  <TextInput
                    value={trackingNumber}
                    onChangeText={setTrackingNumber}
                    placeholder="Enter tracking number"
                    className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900"
                    placeholderTextColor="#9CA3AF"
                  />
                  <Text className="text-xs text-gray-500 mt-2">
                    Customer will receive this tracking number via notification
                  </Text>
                </View>
              )}

              {/* Action Buttons */}
              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => setShowStatusModal(false)}
                  className="flex-1 bg-gray-200 py-4 rounded-xl"
                  disabled={updating}
                >
                  <Text className="text-gray-700 font-semibold text-center">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleUpdateStatus}
                  className="flex-1 bg-primary py-4 rounded-xl"
                  disabled={updating}
                >
                  {updating ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-semibold text-center">Update Status</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
