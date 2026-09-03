import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  BadgeCheck,
  ShoppingBag,
  Store,
  Minus,
  Plus,
  ShoppingCart,
  AlertCircle,
} from 'lucide-react-native';
import { api } from '@/lib/api';
import { useCart } from '@/contexts/cart-context';
import { useCoin } from '@/contexts/platform-config-context';

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(0);
  const { addItem, totalItems } = useCart();
  const coin = useCoin();

  const loadProduct = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getProduct(id);
      setProduct(data);
    } catch (error) {
      console.error('Failed to load product:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadProduct();
  }, [loadProduct]);

  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  const handleAddToCart = () => {
    if (!product) return;

    addItem(
      {
        id: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        priceUSD: product.priceUSD,
      },
      {
        id: product.store.id,
        name: product.store.name,
        isScVerified: product.store.isScVerified,
      },
      quantity
    );

    Alert.alert(
      'Added to Cart',
      `${quantity} x ${product.name} added to your cart.`,
      [
        { text: 'Continue Shopping', style: 'cancel' },
        {
          text: 'View Cart',
          onPress: () => router.push('/cart'),
        },
      ]
    );
  };

  const handleBuyNow = () => {
    if (!product) return;

    addItem(
      {
        id: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        priceUSD: product.priceUSD,
      },
      {
        id: product.store.id,
        name: product.store.name,
        isScVerified: product.store.isScVerified,
      },
      quantity
    );

    router.push(`/checkout?storeId=${product.store.id}`);
  };

  if (loading || !product) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#FF6B00" />
          <Text className="text-gray-500 dark:text-gray-400 mt-4">Loading product...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const allImages = [product.imageUrl, ...(product.images || [])].filter(Boolean);

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <TouchableOpacity onPress={() => router.back()}>
          <ArrowLeft size={24} color="#374151" />
        </TouchableOpacity>
        <Text className="text-lg font-semibold text-gray-900 dark:text-white flex-1 ml-4" numberOfLines={1}>
          {product.name}
        </Text>
        <TouchableOpacity onPress={() => router.push('/cart')} className="relative">
          <ShoppingCart size={24} color="#374151" />
          {totalItems > 0 && (
            <View className="absolute -top-2 -right-2 bg-primary w-5 h-5 rounded-full items-center justify-center">
              <Text className="text-white text-xs font-bold">{totalItems > 99 ? '99+' : totalItems}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Product Images */}
        <View className="bg-white dark:bg-gray-800">
          <View className="h-80 bg-gray-200 dark:bg-gray-700">
            {allImages.length > 0 ? (
              <Image
                source={{ uri: allImages[selectedImage] }}
                className="w-full h-full"
                resizeMode="contain"
              />
            ) : (
              <View className="w-full h-full items-center justify-center">
                <ShoppingBag size={80} color="#9CA3AF" />
              </View>
            )}
            {/* Sale Badge */}
            {product.compareAtPrice && product.compareAtPrice > product.priceUSD && (
              <View className="absolute top-4 right-4 bg-red-500 px-3 py-1 rounded-full">
                <Text className="text-white font-bold">
                  {Math.round((1 - product.priceUSD / product.compareAtPrice) * 100)}% OFF
                </Text>
              </View>
            )}
          </View>

          {/* Image Thumbnails */}
          {allImages.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="px-4 py-3"
            >
              {allImages.map((img, index) => (
                <TouchableOpacity
                  key={index}
                  onPress={() => setSelectedImage(index)}
                  className={`w-16 h-16 rounded-lg overflow-hidden mr-2 border-2 ${
                    selectedImage === index
                      ? 'border-amber-500'
                      : 'border-transparent'
                  }`}
                >
                  <Image
                    source={{ uri: img }}
                    className="w-full h-full"
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Product Info */}
        <View className="px-5 py-4">
          {/* Store Info */}
          <TouchableOpacity
            onPress={() => router.push(`/store-detail?id=${product.store.id}`)}
            className="flex-row items-center mb-4"
          >
            <Store size={16} color="#6B7280" />
            <Text className="text-gray-600 dark:text-gray-400 ml-2">
              {product.store.name}
            </Text>
            {product.store.isScVerified && (
              <View className="ml-2 flex-row items-center">
                <BadgeCheck size={14} color="#FF6B00" />
                <Text className="text-primary text-xs ml-1">SC Verified</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Product Name */}
          <Text className="text-2xl font-bold text-gray-900 dark:text-white">
            {product.name}
          </Text>

          {/* Pricing */}
          <View className="mt-4">
            <View className="flex-row items-baseline">
              <Text className="text-3xl font-bold text-gray-900 dark:text-white">
                {formatPrice(product.priceUSD)}
              </Text>
              {product.compareAtPrice && product.compareAtPrice > product.priceUSD && (
                <Text className="text-lg text-gray-400 line-through ml-3">
                  {formatPrice(product.compareAtPrice)}
                </Text>
              )}
            </View>

          </View>

          {/* Stock Status */}
          {product.trackInventory && (
            <View className="mt-4 flex-row items-center">
              {product.quantity > 0 ? (
                <>
                  <View className="w-2 h-2 rounded-full bg-green-500 mr-2" />
                  <Text className="text-green-600 dark:text-green-400">
                    {product.quantity > 10 ? 'In Stock' : `Only ${product.quantity} left`}
                  </Text>
                </>
              ) : product.allowBackorder ? (
                <>
                  <View className="w-2 h-2 rounded-full bg-primary mr-2" />
                  <Text className="text-primary dark:text-amber-400">
                    Available for backorder
                  </Text>
                </>
              ) : (
                <>
                  <View className="w-2 h-2 rounded-full bg-red-500 mr-2" />
                  <Text className="text-red-600 dark:text-red-400">Out of Stock</Text>
                </>
              )}
            </View>
          )}

          {/* Description */}
          {product.description && (
            <View className="mt-6">
              <Text className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Description
              </Text>
              <Text className="text-gray-600 dark:text-gray-300 leading-relaxed">
                {product.description}
              </Text>
            </View>
          )}

          {/* SC Verified Info */}
          {product.store.isScVerified && (
            <View className="mt-6 bg-secondary dark:bg-amber-900/30 rounded-xl p-4">
              <View className="flex-row items-center mb-2">
                <BadgeCheck size={20} color="#FF6B00" />
                <Text className="text-amber-800 dark:text-amber-200 font-semibold ml-2">
                  {coin.symbol} Verified Purchase
                </Text>
              </View>
              <Text className="text-primary dark:text-amber-300 text-sm">
                When you purchase from this store, customers earn {coin.name} ({coin.symbol}) tokens which help
                build community wealth and strengthen our commons economy.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Bottom Action Bar */}
      <View className="bg-white dark:bg-gray-800 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
        {/* Quantity Selector */}
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-gray-700 dark:text-gray-300 font-medium">Quantity</Text>
          <View className="flex-row items-center bg-gray-100 dark:bg-gray-700 rounded-full">
            <TouchableOpacity
              onPress={() => setQuantity(Math.max(1, quantity - 1))}
              className="p-3"
            >
              <Minus size={18} color="#6B7280" />
            </TouchableOpacity>
            <Text className="text-lg font-semibold text-gray-900 dark:text-white mx-4">
              {quantity}
            </Text>
            <TouchableOpacity
              onPress={() => {
                if (!product.trackInventory || product.quantity === null || quantity < product.quantity || product.allowBackorder) {
                  setQuantity(quantity + 1);
                }
              }}
              className="p-3"
            >
              <Plus size={18} color="#6B7280" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Action Buttons */}
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={handleAddToCart}
            className="flex-1 bg-gray-100 dark:bg-gray-700 py-4 rounded-xl flex-row items-center justify-center"
          >
            <ShoppingCart size={20} color="#374151" />
            <Text className="text-gray-700 dark:text-gray-300 font-semibold ml-2">
              Add to Cart
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleBuyNow}
            className="flex-1 bg-primary py-4 rounded-xl flex-row items-center justify-center"
            disabled={product.trackInventory && product.quantity === 0 && !product.allowBackorder}
          >
            <Text className="text-white font-bold">Buy Now</Text>
          </TouchableOpacity>
        </View>

        {/* Total */}
        <View className="flex-row items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Text className="text-gray-600 dark:text-gray-400">Total</Text>
          <Text className="text-xl font-bold text-gray-900 dark:text-white">
            {formatPrice(product.priceUSD * quantity)}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
