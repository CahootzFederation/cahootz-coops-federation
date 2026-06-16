import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Building2, Globe, Grid2X2, Mail, Map, MapPin, Phone, Search, Star } from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { coopConfig } from '@/lib/coop-config';
import { resolveBrandColor, withAlpha } from '@/lib/brand-colors';

interface DirectoryBusiness {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  tags: string[];
  isFeatured: boolean;
}

type ViewMode = 'grid' | 'map';

function hasCoordinates(business: DirectoryBusiness) {
  return (
    typeof business.latitude === 'number' &&
    Number.isFinite(business.latitude) &&
    typeof business.longitude === 'number' &&
    Number.isFinite(business.longitude)
  );
}

function businessLocation(business: DirectoryBusiness) {
  return (
    business.formattedAddress ||
    [business.address, business.city, business.state, business.zipCode].filter(Boolean).join(', ')
  );
}

function buildMapboxStaticImageUrl(businesses: DirectoryBusiness[]) {
  const accessToken = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
  if (!accessToken) return null;

  const markers = businesses
    .filter(hasCoordinates)
    .slice(0, 20)
    .map((business, index) => {
      const color = business.isFeatured ? 'F59E0B' : '0F766E';
      const label = index < 9 ? index + 1 : undefined;
      const pin = label ? `pin-s-${label}+${color}` : `pin-s+${color}`;
      return `${pin}(${business.longitude},${business.latitude})`;
    });

  if (markers.length === 0) return null;

  const query = `access_token=${encodeURIComponent(accessToken)}&attribution=true&logo=true&padding=70,70,70,70`;
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${markers.join(',')}/auto/900x620@2x?${query}`;
}

export default function DirectoryScreen() {
  const { user } = useAuth();
  const config = coopConfig();
  const primaryColor = resolveBrandColor(user?.coop?.primaryColor || config.primaryColor, '#B45309');
  const accentColor = resolveBrandColor(user?.coop?.accentColor || config.accentColor, '#0F766E');
  const [businesses, setBusinesses] = useState<DirectoryBusiness[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDirectory = useCallback(async () => {
    try {
      const result = await api.getDirectoryBusinesses({
        coopId: user?.coop?.id,
        search: searchQuery || undefined,
        limit: 100,
      });
      setBusinesses(result?.businesses || []);
    } catch (error) {
      console.error('Failed to load directory:', error);
      setBusinesses([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, user?.coop?.id]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadDirectory();
    }, 250);
    return () => clearTimeout(timeout);
  }, [loadDirectory]);

  useFocusEffect(
    useCallback(() => {
      loadDirectory();
    }, [loadDirectory])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDirectory();
    setRefreshing(false);
  };

  const categories = useMemo(
    () => Array.from(new Set(businesses.map((business) => business.category).filter(Boolean))),
    [businesses]
  );
  const mappedBusinesses = useMemo(() => businesses.filter(hasCoordinates), [businesses]);
  const mapImageUrl = useMemo(() => buildMapboxStaticImageUrl(businesses), [businesses]);

  const openLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch (error) {
      console.error('Could not open link:', error);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={primaryColor} />
          <Text className="mt-4 text-gray-500">Loading directory...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
      <ScrollView
        className="flex-1"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={primaryColor} />}
        showsVerticalScrollIndicator={false}
      >
        <View className="p-5 pb-28">
          <View className="mb-5 flex-row items-center">
            <TouchableOpacity onPress={() => router.back()} className="mr-3">
              <ArrowLeft size={24} color="#374151" />
            </TouchableOpacity>
            <View className="flex-1">
              <Text className="text-2xl font-bold text-gray-900">Directory</Text>
              <Text className="text-sm text-gray-500">
                {businesses.length} local businesses
              </Text>
            </View>
          </View>

          <View className="mb-4 flex-row items-center rounded-2xl border border-gray-200 bg-white px-4 py-3">
            <Search size={20} color="#9CA3AF" />
            <TextInput
              className="ml-3 flex-1 text-base text-gray-900"
              placeholder="Search businesses..."
              placeholderTextColor="#9CA3AF"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {categories.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
              <View className="flex-row gap-2">
                {categories.map((category) => (
                  <View key={category} className="rounded-full bg-white px-3 py-2">
                    <Text className="text-xs font-semibold text-gray-600">{category}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}

          {businesses.length > 0 && (
            <View className="mb-4 flex-row rounded-full border border-gray-200 bg-white p-1">
              <TouchableOpacity
                onPress={() => setViewMode('grid')}
                className="flex-1 flex-row items-center justify-center rounded-full px-4 py-2.5"
                style={{ backgroundColor: viewMode === 'grid' ? primaryColor : 'transparent' }}
              >
                <Grid2X2 size={16} color={viewMode === 'grid' ? '#FFFFFF' : '#4B5563'} />
                <Text
                  className="ml-2 text-sm font-bold"
                  style={{ color: viewMode === 'grid' ? '#FFFFFF' : '#4B5563' }}
                >
                  Grid
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setViewMode('map')}
                className="flex-1 flex-row items-center justify-center rounded-full px-4 py-2.5"
                style={{ backgroundColor: viewMode === 'map' ? primaryColor : 'transparent' }}
              >
                <Map size={16} color={viewMode === 'map' ? '#FFFFFF' : '#4B5563'} />
                <Text
                  className="ml-2 text-sm font-bold"
                  style={{ color: viewMode === 'map' ? '#FFFFFF' : '#4B5563' }}
                >
                  Map
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {businesses.length === 0 ? (
            <View className="items-center justify-center rounded-3xl border border-dashed border-gray-300 bg-white p-10">
              <Building2 size={42} color="#9CA3AF" />
              <Text className="mt-4 text-lg font-bold text-gray-900">No businesses found</Text>
              <Text className="mt-2 text-center text-sm text-gray-500">
                Try a different search or check back as this directory grows.
              </Text>
            </View>
          ) : viewMode === 'map' ? (
            <View className="space-y-4">
              <View className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
                {mapImageUrl ? (
                  <Image source={{ uri: mapImageUrl }} className="h-80 w-full bg-gray-100" resizeMode="cover" />
                ) : (
                  <View className="h-80 items-center justify-center bg-gray-100 px-8">
                    <MapPin size={42} color="#9CA3AF" />
                    <Text className="mt-4 text-center text-lg font-bold text-gray-900">Map locations are not ready yet</Text>
                    <Text className="mt-2 text-center text-sm text-gray-500">
                      Add a Mapbox token and choose suggested addresses for businesses to save coordinates.
                    </Text>
                  </View>
                )}
              </View>

              <Text className="text-sm font-semibold text-gray-500">
                {mappedBusinesses.length} of {businesses.length} businesses have map locations
              </Text>

              {(mappedBusinesses.length > 0 ? mappedBusinesses : businesses).map((business, index) => {
                const location = businessLocation(business);

                return (
                  <View key={business.id} className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
                    <View className="flex-row items-start">
                      <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: accentColor }}>
                        <Text className="text-sm font-black text-white">{index + 1}</Text>
                      </View>
                      <View className="ml-3 flex-1">
                        <View className="flex-row items-start justify-between">
                          <View className="flex-1 pr-2">
                            <Text className="text-base font-bold text-gray-900">{business.name}</Text>
                            {business.category && (
                              <Text className="mt-1 text-sm font-semibold" style={{ color: accentColor }}>
                                {business.category}
                              </Text>
                            )}
                          </View>
                          {business.isFeatured && <Star size={18} color={primaryColor} fill={primaryColor} />}
                        </View>
                        {location && <Text className="mt-2 text-sm leading-5 text-gray-600">{location}</Text>}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <View className="space-y-4">
              {businesses.map((business) => {
                const location = businessLocation(business);

                return (
                  <View key={business.id} className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
                    <View className="h-36 bg-gray-100">
                      {business.imageUrl ? (
                        <Image source={{ uri: business.imageUrl }} className="h-full w-full" resizeMode="cover" />
                      ) : (
                        <View className="h-full items-center justify-center">
                          <Building2 size={42} color="#CBD5E1" />
                        </View>
                      )}
                    </View>
                    <View className="p-4">
                      <View className="mb-2 flex-row items-start justify-between">
                        <View className="flex-1 pr-3">
                          <Text className="text-lg font-bold text-gray-900">{business.name}</Text>
                          {business.category && (
                            <View className="mt-2 self-start rounded-full px-3 py-1" style={{ backgroundColor: withAlpha(accentColor, '1A') }}>
                              <Text className="text-xs font-semibold" style={{ color: accentColor }}>
                                {business.category}
                              </Text>
                            </View>
                          )}
                        </View>
                        {business.isFeatured && <Star size={20} color={primaryColor} fill={primaryColor} />}
                      </View>

                      {business.description && (
                        <Text className="mb-3 text-sm leading-5 text-gray-600">{business.description}</Text>
                      )}

                      {location && (
                        <View className="mb-2 flex-row">
                          <MapPin size={16} color="#6B7280" style={{ marginTop: 2 }} />
                          <Text className="ml-2 flex-1 text-sm text-gray-600">{location}</Text>
                        </View>
                      )}

                      <View className="mt-2 flex-row flex-wrap gap-2">
                        {business.phone && (
                          <TouchableOpacity
                            onPress={() => openLink(`tel:${business.phone}`)}
                            className="flex-row items-center rounded-full bg-gray-100 px-3 py-2"
                          >
                            <Phone size={14} color="#374151" />
                            <Text className="ml-1.5 text-xs font-semibold text-gray-700">Call</Text>
                          </TouchableOpacity>
                        )}
                        {business.email && (
                          <TouchableOpacity
                            onPress={() => openLink(`mailto:${business.email}`)}
                            className="flex-row items-center rounded-full bg-gray-100 px-3 py-2"
                          >
                            <Mail size={14} color="#374151" />
                            <Text className="ml-1.5 text-xs font-semibold text-gray-700">Email</Text>
                          </TouchableOpacity>
                        )}
                        {business.website && (
                          <TouchableOpacity
                            onPress={() => openLink(business.website!)}
                            className="flex-row items-center rounded-full bg-gray-100 px-3 py-2"
                          >
                            <Globe size={14} color="#374151" />
                            <Text className="ml-1.5 text-xs font-semibold text-gray-700">Website</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
