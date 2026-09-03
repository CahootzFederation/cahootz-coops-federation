import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Store,
  ShoppingBag,
  Plus,
  BadgeCheck,
  Clock,
  XCircle,
  Package,
  AlertCircle,
  ChevronRight,
  Edit3,
  QrCode,
  Grid,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/auth-context';
import { useCoin } from '@/contexts/platform-config-context';
import { api } from '@/lib/api';

interface ProductData {
  id: string;
  name: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  priceUSD: number;
  compareAtPrice: number | null;
  quantity: number;
  isActive: boolean;
  totalSold: number;
  createdAt: string;
}

export default function MyStoreScreen() {
  const { user } = useAuth();
  const coin = useCoin();
  const params = useLocalSearchParams();
  const storeId = params.storeId as string | undefined;
  
  const [store, setStore] = useState<any>(null);
  const [products, setProducts] = useState<ProductData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [storeCategories, setStoreCategories] = useState<{ key: string; label: string }[]>([]);

  const loadStore = useCallback(async () => {
    if (!user?.walletAddress) return;
    try {
      if (storeId) {
        // Load specific store from the list
        const storesData = await api.getMyStores(user.walletAddress);
        const foundStore = storesData?.find((s: any) => s.id === storeId);
        setStore(foundStore || null);
      } else {
        // Load most recent store (backwards compatibility)
        const storeData = await api.getMyStore(user.walletAddress);
        setStore(storeData);
      }
    } catch (error) {
      console.error('Failed to load store:', error);
    }
  }, [user?.walletAddress, storeId]);

  const loadProducts = useCallback(async () => {
    if (!user?.walletAddress) return;
    try {
      const productsData = await api.getMyProducts(user.walletAddress, true, storeId);
      setProducts(productsData);
    } catch (error) {
      console.error('Failed to load products:', error);
    }
  }, [user?.walletAddress, storeId]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadStore(), loadProducts()]);
      setLoading(false);
    };
    init();
  }, [loadStore, loadProducts]);

  // Load store categories
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const categories = await api.getStoreCategories(true); // Include admin-only for viewing
        setStoreCategories(categories);
      } catch (error) {
        console.error('Failed to load store categories:', error);
      }
    };
    loadCategories();
  }, []);

  // Refresh products when screen comes into focus (after adding/editing)
  useFocusEffect(
    useCallback(() => {
      if (!loading) {
        loadProducts();
      }
    }, [loadProducts, loading])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadStore(), loadProducts()]);
    setRefreshing(false);
  };

  const getCategoryLabel = (value: string) => {
    return storeCategories.find((c) => c.key === value)?.label || value;
  };

  const formatPrice = (price: number) => {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getStatusBadge = () => {
    if (!store) return null;

    switch (store.status) {
      case 'PENDING':
        return (
          <View className="bg-yellow-100 dark:bg-yellow-900/30 px-3 py-1 rounded-full flex-row items-center">
            <Clock size={14} color="#CA8A04" />
            <Text className="text-yellow-700 dark:text-yellow-300 font-medium ml-1">
              Pending Approval
            </Text>
          </View>
        );
      case 'APPROVED':
        return (
          <View className="bg-green-100 dark:bg-green-900/30 px-3 py-1 rounded-full flex-row items-center">
            <BadgeCheck size={14} color="#16A34A" />
            <Text className="text-green-700 dark:text-green-300 font-medium ml-1">
              Approved
            </Text>
          </View>
        );
      case 'SUSPENDED':
        return (
          <View className="bg-red-100 dark:bg-red-900/30 px-3 py-1 rounded-full flex-row items-center">
            <AlertCircle size={14} color="#DC2626" />
            <Text className="text-red-700 dark:text-red-300 font-medium ml-1">
              Suspended
            </Text>
          </View>
        );
      case 'REJECTED':
        return (
          <View className="bg-red-100 dark:bg-red-900/30 px-3 py-1 rounded-full flex-row items-center">
            <XCircle size={14} color="#DC2626" />
            <Text className="text-red-700 dark:text-red-300 font-medium ml-1">
              Rejected
            </Text>
          </View>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#FF6B00" />
          <Text className="text-gray-500 dark:text-gray-400 mt-4">Loading your store...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!store) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900">
        <View className="flex-row items-center px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <TouchableOpacity onPress={() => router.back()}>
            <ArrowLeft size={24} color="#374151" />
          </TouchableOpacity>
          <Text className="text-lg font-semibold text-gray-900 dark:text-white ml-4">
            My Store
          </Text>
        </View>
        <View className="flex-1 items-center justify-center px-8">
          <Store size={64} color="#9CA3AF" />
          <Text className="text-xl font-bold text-gray-900 dark:text-white mt-4 text-center">
            {storeId ? 'Store Not Found' : 'No Store Yet'}
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center mt-2">
            {storeId 
              ? 'This store could not be found or you don\'t have access to it.'
              : 'You haven\'t applied to become a store yet. Apply now, connect Stripe, and start selling.'}
          </Text>
          <TouchableOpacity
            onPress={() => router.push(storeId ? '/(authenticated)/my-stores' as any : '/(authenticated)/apply-store' as any)}
            className="bg-primary px-8 py-4 rounded-xl mt-6"
          >
            <Text className="text-white font-bold">
              {storeId ? 'View All Commons Stores' : 'Apply to Become a Commons Store'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <TouchableOpacity onPress={() => router.back()}>
          <ArrowLeft size={24} color="#374151" />
        </TouchableOpacity>
        <Text className="text-lg font-semibold text-gray-900 dark:text-white">My Store</Text>
        <TouchableOpacity onPress={() => router.push('/(authenticated)/my-stores' as any)}>
          <Grid size={24} color="#374151" />
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B00" />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Store Info Card */}
        <View className="mx-5 mt-4">
          <View className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-sm">
            {/* Store Header */}
            <LinearGradient
              colors={['#FF8A2A', '#FF6B00']}
              className="p-5"
            >
              <View className="flex-row items-center">
                <View className="w-16 h-16 rounded-xl bg-white/20 items-center justify-center">
                  {store.imageUrl ? (
                    <Image
                      source={{ uri: store.imageUrl }}
                      className="w-full h-full rounded-xl"
                      resizeMode="cover"
                    />
                  ) : (
                    <Store size={32} color="white" />
                  )}
                </View>
                <View className="flex-1 ml-4">
                  <Text className="text-xl font-bold text-white">{store.name}</Text>
                  <Text className="text-white/80">{getCategoryLabel(store.category)}</Text>
                </View>
              </View>
              <View className="flex-row items-center mt-4 gap-2">
                {getStatusBadge()}
                {store.isScVerified && (
                  <View className="bg-white/20 px-3 py-1 rounded-full flex-row items-center">
                    <BadgeCheck size={14} color="white" />
                    <Text className="text-white font-medium ml-1">SC Verified</Text>
                  </View>
                )}
                {!store.isScVerified && store.scApplicationStatus === 'PENDING' && (
                  <View className="bg-white/20 px-3 py-1 rounded-full flex-row items-center">
                    <Clock size={14} color="white" />
                    <Text className="text-white font-medium ml-1">SC Review Pending</Text>
                  </View>
                )}
              </View>
            </LinearGradient>

            {/* Application Status (if pending/rejected) */}
            {(store.status === 'PENDING' || store.status === 'REJECTED') && store.application && (
              <View className={`p-4 ${
                store.status === 'PENDING'
                  ? 'bg-yellow-50 dark:bg-yellow-900/20'
                  : 'bg-red-50 dark:bg-red-900/20'
              }`}>
                <View className="flex-row items-start">
                  {store.status === 'PENDING' ? (
                    <Clock size={20} color="#CA8A04" />
                  ) : (
                    <XCircle size={20} color="#DC2626" />
                  )}
                  <View className="flex-1 ml-3">
                    <Text className={`font-semibold ${
                      store.status === 'PENDING'
                        ? 'text-yellow-800 dark:text-yellow-200'
                        : 'text-red-800 dark:text-red-200'
                    }`}>
                      {store.status === 'PENDING'
                        ? 'Application Under Review'
                        : 'Action Required'}
                    </Text>
                    <Text className={`text-sm mt-1 ${
                      store.status === 'PENDING'
                        ? 'text-yellow-700 dark:text-yellow-300'
                        : 'text-red-700 dark:text-red-300'
                    }`}>
                      {store.status === 'PENDING'
                        ? 'Your application is being reviewed. You will be notified once approved.'
                        : 'Your payment setup needs attention. Tap "Continue Stripe Connect" below to fix any outstanding issues and activate your store.'}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Stats */}
            {store.status === 'APPROVED' && (
              <View className="flex-row p-4 border-t border-gray-100 dark:border-gray-700">
                <View className="flex-1 items-center">
                  <View className="flex-row items-center">
                    <Text className="text-xl font-bold text-gray-900 dark:text-white">
                      {formatPrice(store.totalSales)}
                    </Text>
                  </View>
                  <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">Total Sales</Text>
                </View>
                <View className="flex-1 items-center border-x border-gray-100 dark:border-gray-700">
                  <View className="flex-row items-center">
                    <Package size={16} color="#FF6B00" />
                    <Text className="text-xl font-bold text-gray-900 dark:text-white ml-1">
                      {store.totalOrders}
                    </Text>
                  </View>
                  <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">Orders</Text>
                </View>
                <View className="flex-1 items-center">
                  <View className="flex-row items-center">
                    <ShoppingBag size={16} color="#FF6B00" />
                    <Text className="text-xl font-bold text-gray-900 dark:text-white ml-1">
                      {store.productCount}
                    </Text>
                  </View>
                  <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">Products</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Stripe + SC Status */}
        <View className="mx-5 mt-4 gap-3">
          {store.status !== 'APPROVED' && (
            <View className="bg-white dark:bg-gray-800 rounded-2xl p-5">
              <View className="flex-row items-start">
                <AlertCircle size={20} color="#FF6B00" />
                <View className="flex-1 ml-3">
                  <Text className="text-gray-900 dark:text-white font-semibold">Finish Stripe Connect to go live</Text>
                  <Text className="text-gray-600 dark:text-gray-300 text-sm mt-1">
                    Your store becomes active as soon as Stripe enables charges. You do not need a separate admin approval for the base store.
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/stripe-onboarding', params: { storeId: store.id } })}
                className="bg-primary py-3 rounded-xl mt-4"
              >
                <Text className="text-center text-white font-semibold">
                  {store.businessId ? 'Continue Stripe Connect' : 'Start Stripe Connect'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {store.status === 'APPROVED' && !store.isScVerified && (
            <View className="bg-white dark:bg-gray-800 rounded-2xl p-5">
              <View className="flex-row items-start">
                <BadgeCheck size={20} color="#FF6B00" />
                <View className="flex-1 ml-3">
                  <Text className="text-gray-900 dark:text-white font-semibold">
                    {store.scApplicationStatus === 'PENDING' ? `${coin.symbol} rewards application under review` : `Apply to earn ${coin.symbol} rewards`}
                  </Text>
                  <Text className="text-gray-600 dark:text-gray-300 text-sm mt-1">
                    {store.scApplicationStatus === 'PENDING'
                      ? `Your store is already live. ${coin.symbol} rewards will activate after your separate application is approved.`
                      : store.scApplicationStatus === 'REJECTED'
                      ? store.scVerificationApplication?.rejectionReason || `Your last ${coin.symbol} rewards application was rejected. You can apply again.`
                      : `Your store is live. Apply separately if you want purchases to qualify for ${coin.symbol} rewards.`}
                  </Text>
                </View>
              </View>
              {store.scApplicationStatus !== 'PENDING' && (
                <TouchableOpacity
                  onPress={() => router.push({ pathname: '/apply-sc-verification', params: { storeId: store.id } })}
                  className="bg-green-600 py-3 rounded-xl mt-4"
                >
                  <Text className="text-center text-white font-semibold">
                    {store.scApplicationStatus === 'REJECTED' ? 'Reapply for SC Verification' : 'Apply for SC Verification'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Quick Actions */}
        {store.status === 'APPROVED' && (
          <View className="mx-5 mt-4 gap-3">
            {/* Quick Pay Card */}
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/(authenticated)/accept-payment', params: { storeId: store.id } } as any)}
            >
              <LinearGradient
                colors={['#10B981', '#059669']}
                className="rounded-2xl p-5 flex-row items-center"
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <View className="w-12 h-12 rounded-full bg-white/20 items-center justify-center">
                  <QrCode size={24} color="white" />
                </View>
                <View className="flex-1 ml-4">
                  <Text className="text-white font-bold text-lg">Accept Payment</Text>
                  <Text className="text-white/80 text-sm">Generate QR codes & payment links</Text>
                </View>
                <ChevronRight size={24} color="white" />
              </LinearGradient>
            </TouchableOpacity>

            {/* View Orders Card */}
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/(authenticated)/store-orders', params: { storeId: store.id } } as any)}
            >
              <LinearGradient
                colors={['#FF8A2A', '#FF6B00']}
                className="rounded-2xl p-5 flex-row items-center"
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <View className="w-12 h-12 rounded-full bg-white/20 items-center justify-center">
                  <Package size={24} color="white" />
                </View>
                <View className="flex-1 ml-4">
                  <Text className="text-white font-bold text-lg">View Orders</Text>
                  <Text className="text-white/80 text-sm">Manage & fulfill customer orders</Text>
                </View>
                <View className="items-end">
                  <Text className="text-white font-bold text-2xl">{store.totalOrders}</Text>
                  <Text className="text-white/80 text-xs">Total</Text>
                </View>
                <ChevronRight size={24} color="white" style={{ marginLeft: 8 }} />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* Products Section */}
        {store.status === 'APPROVED' && (
          <View className="px-5 mt-6 pb-8">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-lg font-bold text-gray-900 dark:text-white">
                My Products ({products.length})
              </Text>
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/add-product', params: { storeId: store.id } })}
                className="bg-primary px-4 py-2 rounded-full flex-row items-center"
              >
                <Plus size={18} color="white" />
                <Text className="text-white font-semibold ml-1">Add</Text>
              </TouchableOpacity>
            </View>

            {products.length === 0 ? (
              <View className="bg-white dark:bg-gray-800 rounded-xl p-8 items-center">
                <ShoppingBag size={48} color="#9CA3AF" />
                <Text className="text-gray-500 dark:text-gray-400 text-center mt-4">
                  No products yet{'\n'}Add your first product to start selling!
                </Text>
                <TouchableOpacity
                  onPress={() => router.push({ pathname: '/add-product', params: { storeId: store.id } })}
                  className="bg-primary px-6 py-3 rounded-xl mt-4"
                >
                  <Text className="text-white font-semibold">Add First Product</Text>
                </TouchableOpacity>
              </View>
            ) : (
              products.map((product) => (
                <TouchableOpacity
                  key={product.id}
                  onPress={() => router.push(`/edit-product?id=${product.id}`)}
                  className="bg-white dark:bg-gray-800 rounded-xl mb-3 overflow-hidden flex-row"
                >
                  {/* Product Image */}
                  <View className="w-24 h-24 bg-gray-200 dark:bg-gray-700">
                    {product.imageUrl ? (
                      <Image
                        source={{ uri: product.imageUrl }}
                        className="w-full h-full"
                        resizeMode="cover"
                      />
                    ) : (
                      <View className="w-full h-full items-center justify-center">
                        <ShoppingBag size={24} color="#9CA3AF" />
                      </View>
                    )}
                    {!product.isActive && (
                      <View className="absolute inset-0 bg-black/50 items-center justify-center">
                        <Text className="text-white text-xs font-bold">INACTIVE</Text>
                      </View>
                    )}
                  </View>

                  {/* Product Info */}
                  <View className="flex-1 p-3 justify-between">
                    <View>
                      <Text className="font-semibold text-gray-900 dark:text-white" numberOfLines={1}>
                        {product.name}
                      </Text>
                      <Text className="text-sm text-gray-500 dark:text-gray-400">
                        {formatPrice(product.priceUSD)}
                      </Text>
                    </View>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs text-gray-500 dark:text-gray-400">
                        {product.quantity} in stock • {product.totalSold} sold
                      </Text>
                      <Edit3 size={16} color="#FF6B00" />
                    </View>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* Pending Store Message */}
        {store.status === 'PENDING' && (
          <View className="px-5 mt-6 pb-8">
            <View className="bg-secondary dark:bg-amber-900/30 rounded-xl p-5">
              <Text className="text-amber-800 dark:text-amber-200 font-semibold text-center">
                What happens next?
              </Text>
              <Text className="text-primary dark:text-amber-300 text-sm text-center mt-2">
                Complete Stripe Connect onboarding and refresh your status. Your store will go live as soon as Stripe enables charges.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
