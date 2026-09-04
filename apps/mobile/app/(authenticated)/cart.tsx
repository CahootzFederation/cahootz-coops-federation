import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Trash2,
  Minus,
  Plus,
  ShoppingBag,
  Store,
  BadgeCheck,
  ReceiptText,
} from 'lucide-react-native';
import { useCart, CartItem } from '@/contexts/cart-context';
import { useAuth } from '@/contexts/auth-context';
import { useCoin } from '@/contexts/platform-config-context';
import { coopConfig } from '@/lib/coop-config';
import { resolveBrandColor, withAlpha } from '@/lib/brand-colors';

function CartItemCard({
  item,
  onUpdateQuantity,
  onRemove,
  accentColor,
}: {
  item: CartItem;
  onUpdateQuantity: (quantity: number) => void;
  onRemove: () => void;
  accentColor: string;
}) {
  const formatPrice = (price: number) => `$${price.toFixed(2)}`;

  return (
    <View className="flex-row bg-white rounded-2xl p-4 mb-3 border border-gray-100">
      {/* Product Image */}
      <View className="w-20 h-20 rounded-lg bg-gray-100 dark:bg-gray-700 overflow-hidden">
        {item.imageUrl ? (
          <Image
            source={{ uri: item.imageUrl }}
            className="w-full h-full"
            resizeMode="cover"
          />
        ) : (
          <View className="w-full h-full items-center justify-center">
            <ShoppingBag size={32} color="#9CA3AF" />
          </View>
        )}
      </View>

      {/* Product Info */}
      <View className="flex-1 ml-4">
        <Text
          className="text-base font-medium text-gray-900 dark:text-white"
          numberOfLines={2}
        >
          {item.name}
        </Text>
        <Text className="text-lg font-bold mt-1" style={{ color: accentColor }}>
          {formatPrice(item.priceUSD)}
        </Text>

        {/* Quantity Controls */}
        <View className="flex-row items-center justify-between mt-2">
          <View className="flex-row items-center bg-gray-100 dark:bg-gray-700 rounded-full">
            <TouchableOpacity
              onPress={() => onUpdateQuantity(item.quantity - 1)}
              className="p-2"
            >
              <Minus size={16} color={accentColor} />
            </TouchableOpacity>
            <Text className="text-base font-semibold text-gray-900 dark:text-white mx-3">
              {item.quantity}
            </Text>
            <TouchableOpacity
              onPress={() => onUpdateQuantity(item.quantity + 1)}
              className="p-2"
            >
              <Plus size={16} color={accentColor} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={onRemove} className="p-2">
            <Trash2 size={18} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function StoreSection({
  storeId,
  storeName,
  isScVerified,
  items,
  onUpdateQuantity,
  onRemoveItem,
  onCheckout,
  accentColor,
  coinSymbol,
}: {
  storeId: string;
  storeName: string;
  isScVerified: boolean;
  items: CartItem[];
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onCheckout: () => void;
  accentColor: string;
  coinSymbol: string;
}) {
  const subtotal = items.reduce(
    (sum, item) => sum + item.priceUSD * item.quantity,
    0
  );

  return (
    <View className="mb-6">
      {/* Store Header */}
      <TouchableOpacity
        onPress={() => router.push(`/store-detail?id=${storeId}`)}
        className="flex-row items-center mb-3"
      >
        <Store size={18} color={accentColor} />
        <Text className="text-base font-semibold text-gray-900 dark:text-white ml-2">
          {storeName}
        </Text>
        {isScVerified && (
          <View className="flex-row items-center ml-2 px-2 py-0.5 rounded-full" style={{ backgroundColor: withAlpha(accentColor, '1A') }}>
            <BadgeCheck size={14} color={accentColor} />
            <Text className="text-xs ml-1 font-medium" style={{ color: accentColor }}>{coinSymbol} rewards</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Cart Items */}
      {items.map((item) => (
        <CartItemCard
          key={item.productId}
          item={item}
          onUpdateQuantity={(qty) => onUpdateQuantity(item.productId, qty)}
          onRemove={() => onRemoveItem(item.productId)}
          accentColor={accentColor}
        />
      ))}

      {/* Subtotal & Checkout */}
      <View className="bg-white rounded-2xl p-4 mt-2 border border-gray-100">
        <View className="flex-row justify-between items-center mb-3">
          <Text className="text-gray-600 dark:text-gray-400">Subtotal</Text>
          <Text className="text-lg font-bold text-gray-900 dark:text-white">
            ${subtotal.toFixed(2)}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onCheckout}
          className="py-3 rounded-xl items-center"
          style={{ backgroundColor: accentColor }}
        >
          <Text className="text-white font-bold text-base">
            Checkout
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function CartScreen() {
  const { user } = useAuth();
  const coin = useCoin();
  const config = coopConfig();
  const accentColor = resolveBrandColor(user?.coop?.accentColor || config.accentColor, '#16A34A');
  const {
    items,
    isLoading,
    updateQuantity,
    removeItem,
    clearCart,
    getStoreIds,
    getStoreItems,
    totalItems,
    totalUSD,
  } = useCart();

  const handleCheckout = (storeId: string) => {
    router.push(`/checkout?storeId=${storeId}`);
  };

  const handleClearCart = () => {
    Alert.alert(
      'Clear Cart',
      'Are you sure you want to remove all items from your cart?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => clearCart(),
        },
      ]
    );
  };

  const storeIds = getStoreIds();

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900">
        <View className="flex-1 items-center justify-center">
          <Text className="text-gray-500 dark:text-gray-400">Loading cart...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4 bg-white border-b border-gray-200">
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => router.back()}>
            <ArrowLeft size={24} color="#374151" />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-900 dark:text-white ml-4">
            Cart
          </Text>
          {totalItems > 0 && (
            <View className="px-2 py-0.5 rounded-full ml-2" style={{ backgroundColor: accentColor }}>
              <Text className="text-white text-xs font-bold">{totalItems}</Text>
            </View>
          )}
        </View>
        <View className="flex-row items-center gap-4">
          <TouchableOpacity
            className="flex-row items-center"
            onPress={() => router.push('/(authenticated)/orders' as any)}
          >
            <ReceiptText size={18} color={accentColor} />
            <Text className="ml-1 font-medium" style={{ color: accentColor }}>Orders</Text>
          </TouchableOpacity>
          {items.length > 0 && (
            <TouchableOpacity onPress={handleClearCart}>
              <Text className="text-red-500 font-medium">Clear All</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {items.length === 0 ? (
        /* Empty Cart State */
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full items-center justify-center mb-6">
            <ShoppingBag size={48} color="#9CA3AF" />
          </View>
          <Text className="text-xl font-bold text-gray-900 dark:text-white text-center mb-2">
            Your cart is empty
          </Text>
          <Text className="text-gray-500 dark:text-gray-400 text-center mb-6">
            Browse commons stores and add some products to get started.
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/store' as any)}
            className="px-8 py-3 rounded-xl"
            style={{ backgroundColor: accentColor }}
          >
            <Text className="text-white font-bold text-base">Browse Commons Stores</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/(authenticated)/orders' as any)}
            className="mt-3 px-8 py-3 rounded-xl border border-gray-200 bg-white"
          >
            <Text className="font-bold text-base" style={{ color: accentColor }}>View My Orders</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView className="flex-1 px-5 py-4" showsVerticalScrollIndicator={false}>
          {storeIds.map((storeId) => {
            const storeItems = getStoreItems(storeId);
            const firstItem = storeItems[0];
            return (
              <StoreSection
                key={storeId}
                storeId={storeId}
                storeName={firstItem.storeName}
                isScVerified={firstItem.storeIsScVerified}
                items={storeItems}
                onUpdateQuantity={updateQuantity}
                onRemoveItem={removeItem}
                onCheckout={() => handleCheckout(storeId)}
                accentColor={accentColor}
                coinSymbol={coin.symbol}
              />
            );
          })}

          {/* Total Summary */}
          {storeIds.length > 1 && (
            <View className="bg-white dark:bg-gray-800 rounded-xl p-4 mt-2 mb-8">
              <View className="flex-row justify-between items-center">
                <Text className="text-gray-600 dark:text-gray-400 font-medium">
                  Cart Total ({totalItems} items)
                </Text>
                <Text className="text-xl font-bold text-gray-900 dark:text-white">
                  ${totalUSD.toFixed(2)}
                </Text>
              </View>
              <Text className="text-gray-400 dark:text-gray-500 text-sm mt-2">
                Note: You can only checkout from one store at a time.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
