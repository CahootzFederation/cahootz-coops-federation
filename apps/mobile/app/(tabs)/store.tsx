import { useState, useEffect } from "react";
import { View, ScrollView, RefreshControl, TouchableOpacity, Image } from "react-native";
import { router } from "expo-router";
import { Search, MapPin, Star, ShoppingBag } from "lucide-react-native";

import { Text } from "@/components/ui/text";
import { api, resolveCoopId } from "@/lib/api";
import { useCoin } from "@/contexts/platform-config-context";



// Category icons mapping
const CATEGORY_ICONS: Record<string, string> = {
  'FOUNDER_PACKAGE': '🎖️',
  'FOOD_BEVERAGE': '🍔',
  'RETAIL': '🛍️',
  'SERVICES': '✂️',
  'HEALTH_WELLNESS': '💊',
  'ENTERTAINMENT': '🎭',
  'EDUCATION': '📚',
  'PROFESSIONAL': '💼',
  'HOME_GARDEN': '🏡',
  'AUTOMOTIVE': '🚗',
  'OTHER': '📦',
};

export default function StoreScreen() {
  const platformCoin = useCoin();
  const [coopCoin, setCoopCoin] = useState(platformCoin);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [storeCategories, setStoreCategories] = useState<{ key: string; label: string }[]>([]);
  const [featuredStores, setFeaturedStores] = useState<{
    id: string;
    name: string;
    category: string;
    imageUrl: string | null;
    isScVerified: boolean;
    rating: number | null;
    reviewCount: number;
    city?: string | null;
    state?: string | null;
  }[]>([]);

  // Load store categories on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const activeCoopId = resolveCoopId();
        const [categories, storesResult, coopConfig] = await Promise.all([
          api.getStoreCategories(true),
          api.getStores({
            featured: true,
            category: selectedCategory || undefined,
            limit: 20,
          }),
          activeCoopId === 'error-no-coop-id' ? Promise.resolve(null) : api.getCoopConfig(activeCoopId),
        ]);
        setStoreCategories(categories);
        setFeaturedStores(storesResult?.stores || []);
        setCoopCoin({
          symbol: coopConfig?.scTokenSymbol || platformCoin.symbol,
          name: coopConfig?.scTokenName || platformCoin.name,
          description: platformCoin.description,
        });
      } catch (error) {
        console.error('Failed to load store data:', error);
      }
    };
    loadData();
  }, [platformCoin.description, platformCoin.name, platformCoin.symbol, selectedCategory]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const storesResult = await api.getStores({
        featured: true,
        category: selectedCategory || undefined,
        limit: 20,
      });
      setFeaturedStores(storesResult?.stores || []);
    } catch (error) {
      console.error('Failed to refresh stores:', error);
    }
    setRefreshing(false);
  };

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: '#FFFBEB' }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#B45309" />
      }
    >
      {/* Header */}
      <View className="px-4 pt-14 pb-4">
        <Text className="text-xl font-bold text-gray-800">Community Store</Text>
        <Text className="text-gray-500 text-sm">Support local businesses, earn {coopCoin.symbol} rewards</Text>
      </View>

      {/* Search Bar */}
      <View className="px-4 mb-4">
        <TouchableOpacity
          className="flex-row items-center bg-white rounded-xl px-4 py-3 border border-amber-200"
          activeOpacity={0.7}
        >
          <Search size={20} color="#9CA3AF" />
          <Text className="ml-3 text-gray-400 flex-1">Search stores...</Text>
        </TouchableOpacity>
      </View>

      {/* Categories */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="px-4 mb-4"
      >
        {/* All Categories */}
        <TouchableOpacity
          onPress={() => setSelectedCategory(null)}
          className={`mr-3 px-4 py-2 rounded-full flex-row items-center ${
            selectedCategory === null
              ? 'bg-amber-600'
              : 'bg-white border border-amber-200'
          }`}
        >
          <Text className="mr-1">🏪</Text>
          <Text
            className={`text-sm font-medium ${
              selectedCategory === null ? 'text-white' : 'text-gray-700'
            }`}
          >
            All
          </Text>
        </TouchableOpacity>

        {/* Dynamic Categories */}
        {storeCategories.map((category) => (
          <TouchableOpacity
            key={category.key}
            onPress={() => setSelectedCategory(category.key)}
            className={`mr-3 px-4 py-2 rounded-full flex-row items-center ${
              selectedCategory === category.key
                ? 'bg-amber-600'
                : 'bg-white border border-amber-200'
            }`}
          >
            <Text className="mr-1">{CATEGORY_ICONS[category.key] || '📦'}</Text>
            <Text
              className={`text-sm font-medium ${
                selectedCategory === category.key ? 'text-white' : 'text-gray-700'
              }`}
            >
              {category.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Featured Stores */}
      <View className="px-4">
        <Text className="text-lg font-semibold text-gray-800 mb-3">Featured Stores</Text>

        {featuredStores.map((store) => (
          <TouchableOpacity
            key={store.id}
            className="bg-white rounded-2xl p-4 mb-3 border border-amber-100"
            activeOpacity={0.7}
            onPress={() => router.push(`/store-detail?id=${store.id}`)}
          >
            <View className="flex-row">
              {/* Store Image */}
              {store.imageUrl ? (
                <Image
                  source={{ uri: store.imageUrl }}
                  className="w-16 h-16 rounded-xl mr-3"
                />
              ) : (
                <View className="w-16 h-16 rounded-xl bg-amber-100 items-center justify-center mr-3">
                  <ShoppingBag size={24} color="#B45309" />
                </View>
              )}

              {/* Store Info */}
              <View className="flex-1">
                <View className="flex-row items-center">
                  <Text className="text-base font-semibold text-gray-800">{store.name}</Text>
                  {store.isScVerified && (
                    <View className="ml-2 bg-green-100 px-2 py-0.5 rounded-full">
                      <Text className="text-xs text-green-700 font-medium">{coopCoin.symbol}</Text>
                    </View>
                  )}
                </View>
                <Text className="text-sm text-gray-500">{store.category}</Text>

                <View className="flex-row items-center mt-1">
                  <Star size={14} color="#F59E0B" fill="#F59E0B" />
                  <Text className="text-sm text-gray-600 ml-1">
                    {store.rating ?? 0} ({store.reviewCount})
                  </Text>
                  {(store.city || store.state) && (
                    <View className="flex-row items-center ml-3">
                      <MapPin size={12} color="#9CA3AF" />
                      <Text className="text-sm text-gray-400 ml-1">
                        {[store.city, store.state].filter(Boolean).join(', ')}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Coin Verified Info */}
      <View className="mx-4 mt-4 mb-8 bg-green-50 rounded-2xl p-4 border border-green-200">
        <Text className="text-green-800 font-semibold mb-2">Earn {coopCoin.symbol} Rewards</Text>
        <Text className="text-green-700 text-sm">
          Shop at {coopCoin.symbol}-verified stores and earn 1% back in {coopCoin.name} on every purchase!
        </Text>
      </View>
    </ScrollView>
  );
}
