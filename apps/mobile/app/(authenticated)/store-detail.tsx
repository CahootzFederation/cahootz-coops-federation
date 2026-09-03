import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  BadgeCheck,
  MapPin,
  Phone,
  Mail,
  Globe,
  Star,
  ShoppingBag,
  ShoppingCart,
  Plus,
  Minus,
  ChevronRight,
} from 'lucide-react-native';
import { api } from '@/lib/api';
import { useCart } from '@/contexts/cart-context';

interface ProductData {
  id: string;
  name: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  priceUSD: number;
  compareAtPrice: number | null;
  ucDiscountPrice: number | null;
  quantity: number | null;
  isFeatured: boolean;
  store: {
    id: string;
    name: string;
    isScVerified: boolean;
    acceptsUC: boolean;
    ucDiscountPercent: number;
  };
}

export default function StoreDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items: cartItems, addItem, updateQuantity, removeItem, totalItems } = useCart();

  const getCartQuantity = (productId: string) => {
    const item = cartItems.find(i => i.productId === productId);
    return item?.quantity || 0;
  };
  const [store, setStore] = useState<any>(null);
  const [products, setProducts] = useState<ProductData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [productCategories, setProductCategories] = useState<{ key: string; label: string }[]>([]);

  const handleAddToCart = (product: ProductData) => {
    if (!store) return;
    addItem(
      {
        id: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        priceUSD: product.priceUSD,
      },
      {
        id: store.id,
        name: store.name,
        isScVerified: store.isScVerified,
      }
    );
  };

  const loadStore = useCallback(async () => {
    if (!id) return;
    try {
      const storeData = await api.getStore(id);
      setStore(storeData);
    } catch (error) {
      console.error('Failed to load store:', error);
    }
  }, [id]);

  const loadProducts = useCallback(async () => {
    if (!id) return;
    try {
      const result = await api.getProducts({
        storeId: id,
        category: selectedCategory || undefined,
        limit: 50,
      });
      setProducts(result.products);
    } catch (error) {
      console.error('Failed to load products:', error);
    }
  }, [id, selectedCategory]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadStore(), loadProducts()]);
      setLoading(false);
    };
    init();
  }, [loadStore, loadProducts]);

  // Load product categories
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const categories = await api.getProductCategories(true); // Include admin-only for viewing
        setProductCategories(categories);
      } catch (error) {
        console.error('Failed to load product categories:', error);
      }
    };
    loadCategories();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadStore(), loadProducts()]);
    setRefreshing(false);
  };

  const getCategoryLabel = (value: string) => {
    return productCategories.find(c => c.key === value)?.label || value;
  };

  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  if (loading || !store) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#FF6B00" />
          <Text className="text-gray-500 dark:text-gray-400 mt-4">Loading store...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900" edges={['top']}>
      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B00" />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Store Header */}
        <View className="relative">
          {/* Banner Image */}
          <View className="h-48 bg-gray-200 dark:bg-gray-700">
            {store.bannerUrl || store.imageUrl ? (
              <Image
                source={{ uri: store.bannerUrl || store.imageUrl }}
                className="w-full h-full"
                resizeMode="cover"
              />
            ) : (
              <LinearGradient
                colors={['#FF8A2A', '#FF6B00']}
                className="w-full h-full"
              />
            )}
            {/* Back Button */}
            <TouchableOpacity
              onPress={() => router.back()}
              className="absolute top-4 left-4 bg-black/30 p-2 rounded-full"
            >
              <ArrowLeft size={24} color="white" />
            </TouchableOpacity>
            {/* Cart Button */}
            <TouchableOpacity
              onPress={() => router.push('/(authenticated)/cart')}
              className="absolute top-4 right-4 bg-black/30 p-2 rounded-full"
            >
              <ShoppingCart size={24} color="white" />
              {totalItems > 0 && (
                <View className="absolute -top-1 -right-1 bg-primary rounded-full min-w-[20px] h-5 items-center justify-center">
                  <Text className="text-white text-xs font-bold">
                    {totalItems > 99 ? '99+' : totalItems}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Store Logo */}
          <View className="absolute -bottom-12 left-5">
            <View className="w-24 h-24 rounded-2xl bg-white dark:bg-gray-800 shadow-lg items-center justify-center overflow-hidden border-4 border-white dark:border-gray-800">
              {store.imageUrl ? (
                <Image
                  source={{ uri: store.imageUrl }}
                  className="w-full h-full"
                  resizeMode="cover"
                />
              ) : (
                <ShoppingBag size={40} color="#FF6B00" />
              )}
            </View>
          </View>
        </View>

        {/* Store Info */}
        <View className="mt-16 px-5">
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Text className="text-2xl font-bold text-gray-900 dark:text-white">
                {store.name}
              </Text>
              {store.rating && (
                <View className="flex-row items-center mt-1">
                  <Star size={16} color="#F59E0B" fill="#F59E0B" />
                  <Text className="text-amber-500 font-semibold ml-1">
                    {store.rating.toFixed(1)}
                  </Text>
                  <Text className="text-gray-500 dark:text-gray-400 ml-1">
                    ({store.reviewCount} reviews)
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Badges */}
          {store.isScVerified && (
            <View className="flex-row flex-wrap gap-2 mt-3">
              <View className="bg-secondary dark:bg-amber-900/30 px-3 py-2 rounded-full flex-row items-center">
                <BadgeCheck size={16} color="#FF6B00" />
                <Text className="text-primary dark:text-amber-300 font-semibold ml-1">
                  SC Verified - Earns SC
                </Text>
              </View>
            </View>
          )}

          {/* Description */}
          {store.description && (
            <Text className="text-gray-600 dark:text-gray-300 mt-4 leading-relaxed">
              {store.description}
            </Text>
          )}

          {/* Contact Info */}
          <View className="mt-6 bg-white dark:bg-gray-800 rounded-xl p-4 space-y-3">
            {(store.address || store.city) && (
              <TouchableOpacity
                className="flex-row items-center"
                onPress={() => {
                  const address = [store.address, store.city, store.state, store.zipCode]
                    .filter(Boolean)
                    .join(', ');
                  Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(address)}`);
                }}
              >
                <MapPin size={20} color="#6B7280" />
                <Text className="text-gray-600 dark:text-gray-300 ml-3 flex-1">
                  {[store.address, store.city, store.state].filter(Boolean).join(', ')}
                </Text>
              </TouchableOpacity>
            )}
            {store.phone && (
              <TouchableOpacity
                className="flex-row items-center"
                onPress={() => Linking.openURL(`tel:${store.phone}`)}
              >
                <Phone size={20} color="#6B7280" />
                <Text className="text-gray-600 dark:text-gray-300 ml-3">
                  {store.phone}
                </Text>
              </TouchableOpacity>
            )}
            {store.email && (
              <TouchableOpacity
                className="flex-row items-center"
                onPress={() => Linking.openURL(`mailto:${store.email}`)}
              >
                <Mail size={20} color="#6B7280" />
                <Text className="text-gray-600 dark:text-gray-300 ml-3">
                  {store.email}
                </Text>
              </TouchableOpacity>
            )}
            {store.website && (
              <TouchableOpacity
                className="flex-row items-center"
                onPress={() => Linking.openURL(store.website)}
              >
                <Globe size={20} color="#6B7280" />
                <Text className="text-primary dark:text-amber-400 ml-3">
                  Visit Website
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Products Section */}
        <View className="mt-8 px-5 pb-8">
          <Text className="text-xl font-bold text-gray-900 dark:text-white mb-4">
            Products ({store.productCount})
          </Text>

          {/* Category Filter */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mb-4 -mx-5 px-5"
          >
            <TouchableOpacity
              onPress={() => setSelectedCategory(null)}
              className={`mr-2 px-4 py-2 rounded-full ${
                !selectedCategory
                  ? 'bg-primary'
                  : 'bg-gray-100 dark:bg-gray-700'
              }`}
            >
              <Text
                className={`font-medium ${
                  !selectedCategory
                    ? 'text-white'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                All
              </Text>
            </TouchableOpacity>
            {productCategories.map((cat) => (
              <TouchableOpacity
                key={cat.key}
                onPress={() => setSelectedCategory(cat.key)}
                className={`mr-2 px-4 py-2 rounded-full ${
                  selectedCategory === cat.key
                    ? 'bg-primary'
                    : 'bg-gray-100 dark:bg-gray-700'
                }`}
              >
                <Text
                  className={`font-medium ${
                    selectedCategory === cat.key
                      ? 'text-white'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Products Grid */}
          {products.length === 0 ? (
            <View className="items-center py-12">
              <ShoppingBag size={48} color="#9CA3AF" />
              <Text className="text-gray-500 dark:text-gray-400 text-center mt-4">
                No products found
              </Text>
            </View>
          ) : (
            <View className="flex-row flex-wrap -mx-2">
              {products.map((product) => (
                <TouchableOpacity
                  key={product.id}
                  onPress={() => router.push(`/product-detail?id=${product.id}`)}
                  className="w-1/2 px-2 mb-4"
                >
                  <View className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow-sm">
                    {/* Product Image */}
                    <View className="h-32 bg-gray-200 dark:bg-gray-700">
                      {product.imageUrl ? (
                        <Image
                          source={{ uri: product.imageUrl }}
                          className="w-full h-full"
                          resizeMode="cover"
                        />
                      ) : (
                        <View className="w-full h-full items-center justify-center">
                          <ShoppingBag size={32} color="#9CA3AF" />
                        </View>
                      )}
                      {product.compareAtPrice && product.compareAtPrice > product.priceUSD && (
                        <View className="absolute top-2 right-2 bg-red-500 px-2 py-1 rounded-full">
                          <Text className="text-white text-xs font-bold">
                            -{Math.round((1 - product.priceUSD / product.compareAtPrice) * 100)}%
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Product Info */}
                    <View className="p-3">
                      <Text
                        className="text-sm font-semibold text-gray-900 dark:text-white"
                        numberOfLines={2}
                      >
                        {product.name}
                      </Text>
                      <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {getCategoryLabel(product.category)}
                      </Text>

                      <View className="mt-2 flex-row items-center justify-between">
                        <View>
                          <Text className="text-lg font-bold text-primary dark:text-amber-400">
                            {formatPrice(product.priceUSD)}
                          </Text>
                          {product.compareAtPrice && product.compareAtPrice > product.priceUSD && (
                            <Text className="text-xs text-gray-400 line-through">
                              {formatPrice(product.compareAtPrice)}
                            </Text>
                          )}
                        </View>
                        {getCartQuantity(product.id) > 0 ? (
                          <View className="flex-row items-center bg-gray-100 dark:bg-gray-700 rounded-full">
                            <TouchableOpacity
                              onPress={() => {
                                const qty = getCartQuantity(product.id);
                                if (qty <= 1) {
                                  removeItem(product.id);
                                } else {
                                  updateQuantity(product.id, qty - 1);
                                }
                              }}
                              className="p-2"
                              activeOpacity={0.7}
                            >
                              <Minus size={14} color="#FF6B00" />
                            </TouchableOpacity>
                            <Text className="text-primary dark:text-amber-400 font-bold text-sm min-w-[20px] text-center">
                              {getCartQuantity(product.id)}
                            </Text>
                            <TouchableOpacity
                              onPress={() => {
                                const qty = getCartQuantity(product.id);
                                updateQuantity(product.id, qty + 1);
                              }}
                              className="p-2"
                              activeOpacity={0.7}
                            >
                              <Plus size={14} color="#FF6B00" />
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity
                            onPress={() => handleAddToCart(product)}
                            className="bg-primary p-2 rounded-full"
                            activeOpacity={0.7}
                          >
                            <Plus size={18} color="white" />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
