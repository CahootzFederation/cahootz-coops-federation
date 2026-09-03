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
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Store,
  Plus,
  BadgeCheck,
  Clock,
  XCircle,
  Package,
  AlertCircle,
  ChevronRight,
  DollarSign,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

interface StoreData {
  id: string;
  name: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  status: string;
  isScVerified: boolean;
  totalSales: number;
  totalOrders: number;
  productCount: number;
  createdAt: string;
}

export default function MyStoresScreen() {
  const { user } = useAuth();
  const [stores, setStores] = useState<StoreData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [storeCategories, setStoreCategories] = useState<{ key: string; label: string }[]>([]);

  const loadStores = useCallback(async () => {
    if (!user?.walletAddress) return;
    try {
      const storesData = await api.getMyStores(user.walletAddress);
      setStores(storesData || []);
    } catch (error) {
      console.error('Failed to load stores:', error);
      setStores([]);
    }
  }, [user?.walletAddress]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadStores();
      setLoading(false);
    };
    init();
  }, [loadStores]);

  // Load store categories
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const categories = await api.getStoreCategories(true);
        setStoreCategories(categories);
      } catch (error) {
        console.error('Failed to load store categories:', error);
      }
    };
    loadCategories();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!loading) {
        loadStores();
      }
    }, [loadStores, loading])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStores();
    setRefreshing(false);
  };

  const getCategoryLabel = (value: string) => {
    return storeCategories.find((c) => c.key === value)?.label || value;
  };

  const formatPrice = (price: number) => {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return (
          <View className="bg-yellow-100 dark:bg-yellow-900/30 px-2 py-1 rounded-full flex-row items-center">
            <Clock size={12} color="#CA8A04" />
            <Text className="text-yellow-700 dark:text-yellow-300 font-medium ml-1 text-xs">
              Pending
            </Text>
          </View>
        );
      case 'APPROVED':
        return (
          <View className="bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded-full flex-row items-center">
            <BadgeCheck size={12} color="#16A34A" />
            <Text className="text-green-700 dark:text-green-300 font-medium ml-1 text-xs">
              Active
            </Text>
          </View>
        );
      case 'SUSPENDED':
        return (
          <View className="bg-red-100 dark:bg-red-900/30 px-2 py-1 rounded-full flex-row items-center">
            <AlertCircle size={12} color="#DC2626" />
            <Text className="text-red-700 dark:text-red-300 font-medium ml-1 text-xs">
              Suspended
            </Text>
          </View>
        );
      case 'REJECTED':
        return (
          <View className="bg-red-100 dark:bg-red-900/30 px-2 py-1 rounded-full flex-row items-center">
            <XCircle size={12} color="#DC2626" />
            <Text className="text-red-700 dark:text-red-300 font-medium ml-1 text-xs">
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
          <Text className="text-gray-500 dark:text-gray-400 mt-4">Loading your stores...</Text>
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
        <Text className="text-lg font-semibold text-gray-900 dark:text-white">My Commons Stores</Text>
        <TouchableOpacity
          onPress={() => router.push('/apply-store')}
          className="bg-primary px-3 py-2 rounded-full flex-row items-center"
        >
          <Plus size={16} color="white" />
          <Text className="text-white font-semibold ml-1 text-xs">New</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B00" />
        }
        showsVerticalScrollIndicator={false}
      >
        {stores.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8 py-20">
            <Store size={64} color="#9CA3AF" />
            <Text className="text-xl font-bold text-gray-900 dark:text-white mt-4 text-center">
              No Commons Stores Yet
            </Text>
            <Text className="text-gray-500 dark:text-gray-400 text-center mt-2">
              You haven&apos;t created any stores yet. Apply now to start selling.
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/apply-store')}
              className="bg-primary px-8 py-4 rounded-xl mt-6"
            >
              <Text className="text-white font-bold">Create Your First Store</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View className="px-5 py-4 gap-4">
            {stores.map((store) => (
              <TouchableOpacity
                key={store.id}
                onPress={() => router.push({ pathname: '/my-store', params: { storeId: store.id } })}
                className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-sm"
              >
                {/* Store Header */}
                <LinearGradient
                  colors={['#FF8A2A', '#FF6B00']}
                  className="p-4"
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center flex-1">
                      <View className="w-12 h-12 rounded-xl bg-white/20 items-center justify-center">
                        {store.imageUrl ? (
                          <Image
                            source={{ uri: store.imageUrl }}
                            className="w-full h-full rounded-xl"
                            resizeMode="cover"
                          />
                        ) : (
                          <Store size={24} color="white" />
                        )}
                      </View>
                      <View className="flex-1 ml-3">
                        <Text className="text-lg font-bold text-white" numberOfLines={1}>
                          {store.name}
                        </Text>
                        <Text className="text-white/80 text-sm">{getCategoryLabel(store.category)}</Text>
                      </View>
                    </View>
                    <ChevronRight size={20} color="white" />
                  </View>
                  <View className="flex-row items-center mt-3 gap-2">
                    {getStatusBadge(store.status)}
                    {store.isScVerified && (
                      <View className="bg-white/20 px-2 py-1 rounded-full flex-row items-center">
                        <BadgeCheck size={12} color="white" />
                        <Text className="text-white font-medium ml-1 text-xs">SC Verified</Text>
                      </View>
                    )}
                  </View>
                </LinearGradient>

                {/* Stats */}
                {store.status === 'APPROVED' && (
                  <View className="flex-row p-3 border-t border-gray-100 dark:border-gray-700">
                    <View className="flex-1 items-center">
                      <View className="flex-row items-center">
                        <DollarSign size={14} color="#FF6B00" />
                        <Text className="text-sm font-bold text-gray-900 dark:text-white">
                          {formatPrice(store.totalSales)}
                        </Text>
                      </View>
                      <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Sales</Text>
                    </View>
                    <View className="flex-1 items-center border-x border-gray-100 dark:border-gray-700">
                      <View className="flex-row items-center">
                        <Package size={14} color="#FF6B00" />
                        <Text className="text-sm font-bold text-gray-900 dark:text-white ml-1">
                          {store.totalOrders}
                        </Text>
                      </View>
                      <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Orders</Text>
                    </View>
                    <View className="flex-1 items-center">
                      <View className="flex-row items-center">
                        <Package size={14} color="#FF6B00" />
                        <Text className="text-sm font-bold text-gray-900 dark:text-white ml-1">
                          {store.productCount}
                        </Text>
                      </View>
                      <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Products</Text>
                    </View>
                  </View>
                )}

                {/* Pending/Rejected Status */}
                {(store.status === 'PENDING' || store.status === 'REJECTED' || store.status === 'SUSPENDED') && (
                  <View className="p-3 bg-gray-50 dark:bg-gray-900">
                    <Text className="text-xs text-gray-500 dark:text-gray-400 text-center">
                      {store.status === 'PENDING' && 'Complete Stripe Connect to activate'}
                      {store.status === 'REJECTED' && 'Application rejected - contact support'}
                      {store.status === 'SUSPENDED' && 'Store suspended - contact support'}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
