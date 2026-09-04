import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  ChevronDown,
  Image as ImageIcon,
  DollarSign,
  Package,
  Trash2,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [productCategories, setProductCategories] = useState<{ key: string; label: string }[]>([]);

  // Form data
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: '',
    imageUrl: '',
    priceUSD: '',
    sku: '',
    quantity: '0',
    trackInventory: true,
    allowBackorder: false,
    isActive: true,
  });

  const loadProduct = useCallback(async () => {
    if (!id || !user?.walletAddress) return;
    try {
      // Get my products and find this one
      const products = await api.getMyProducts(user.walletAddress, true);
      const product = products.find((p: any) => p.id === id);

      if (product) {
        setFormData({
          name: product.name,
          description: product.description || '',
          category: product.category,
          imageUrl: product.imageUrl || '',
          priceUSD: product.priceUSD.toString(),
          sku: product.sku || '',
          quantity: product.quantity.toString(),
          trackInventory: product.trackInventory,
          allowBackorder: product.allowBackorder || false,
          isActive: product.isActive,
        });
      }
    } catch (error) {
      console.error('Failed to load product:', error);
      Alert.alert('Error', 'Failed to load product');
    } finally {
      setLoading(false);
    }
  }, [id, user?.walletAddress]);

  useEffect(() => {
    loadProduct();
  }, [loadProduct]);

  // Load product categories on mount (exclude admin-only for regular users)
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const categories = await api.getProductCategories(false);
        setProductCategories(categories);
      } catch (error) {
        console.error('Failed to load product categories:', error);
      }
    };
    loadCategories();
  }, []);

  const updateField = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const getCategoryLabel = (value: string) => {
    return productCategories.find((c) => c.key === value)?.label || 'Select Category';
  };

  const validateForm = (): boolean => {
    if (!formData.name.trim()) {
      Alert.alert('Required', 'Please enter a product name');
      return false;
    }
    if (!formData.category) {
      Alert.alert('Required', 'Please select a category');
      return false;
    }
    if (!formData.priceUSD || parseFloat(formData.priceUSD) <= 0) {
      Alert.alert('Required', 'Please enter a valid price');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    if (!user?.walletAddress || !id) return;

    setSaving(true);
    try {
      await api.updateProduct(id, {
        name: formData.name,
        description: formData.description || undefined,
        category: formData.category,
        imageUrl: formData.imageUrl || null,
        priceUSD: parseFloat(formData.priceUSD),
        sku: formData.sku || null,
        quantity: parseInt(formData.quantity) || 0,
        trackInventory: formData.trackInventory,
        allowBackorder: formData.allowBackorder,
        isActive: formData.isActive,
      }, user.walletAddress);

      console.log('Product updated successfully');
      router.back();
      setTimeout(() => {
        Alert.alert('Success', 'Product updated successfully!');
      }, 100);
    } catch (error: any) {
      console.error('Update product error:', error);
      Alert.alert('Error', error.message || 'Failed to update product');
      setSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Product',
      'Are you sure you want to delete this product? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!user?.walletAddress || !id) return;

            setDeleting(true);
            try {
              await api.deleteProduct(id, user.walletAddress);
              Alert.alert('Deleted', 'Product has been removed.', [
                { text: 'OK', onPress: () => router.back() },
              ]);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete product');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#FF6B00" />
          <Text className="text-gray-500 dark:text-gray-400 mt-4">Loading product...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-900" edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <TouchableOpacity onPress={() => router.back()}>
            <ArrowLeft size={24} color="#374151" />
          </TouchableOpacity>
          <Text className="text-lg font-semibold text-gray-900 dark:text-white">
            Edit Product
          </Text>
          <TouchableOpacity onPress={handleDelete} disabled={deleting}>
            {deleting ? (
              <ActivityIndicator size="small" color="#DC2626" />
            ) : (
              <Trash2 size={24} color="#DC2626" />
            )}
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 px-5 py-4" showsVerticalScrollIndicator={false}>
          {/* Active Toggle */}
          <View className="bg-white dark:bg-gray-800 rounded-xl mb-6 overflow-hidden">
            <View className="flex-row items-center justify-between px-4 py-4">
              <View className="flex-1">
                <Text className="text-gray-900 dark:text-white font-medium">Product Active</Text>
                <Text className="text-gray-500 dark:text-gray-400 text-sm">
                  {formData.isActive
                    ? 'Product is visible to customers'
                    : 'Product is hidden from customers'}
                </Text>
              </View>
              <Switch
                value={formData.isActive}
                onValueChange={(v) => updateField('isActive', v)}
                trackColor={{ false: '#D1D5DB', true: '#86EFAC' }}
                thumbColor={formData.isActive ? '#16A34A' : '#9CA3AF'}
              />
            </View>
          </View>

          {/* Basic Info */}
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Basic Information
            </Text>

            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Product Name *
              </Text>
              <TextInput
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white"
                placeholder="Enter product name"
                placeholderTextColor="#9CA3AF"
                value={formData.name}
                onChangeText={(v) => updateField('name', v)}
              />
            </View>

            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Category *
              </Text>
              <TouchableOpacity
                onPress={() => setShowCategoryPicker(!showCategoryPicker)}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 flex-row items-center justify-between"
              >
                <Text className={formData.category ? 'text-gray-900 dark:text-white' : 'text-gray-400'}>
                  {getCategoryLabel(formData.category)}
                </Text>
                <ChevronDown size={20} color="#9CA3AF" />
              </TouchableOpacity>
              {showCategoryPicker && (
                <View className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl mt-2 overflow-hidden max-h-48">
                  <ScrollView nestedScrollEnabled>
                    {productCategories.map((cat) => (
                      <TouchableOpacity
                        key={cat.key}
                        onPress={() => {
                          updateField('category', cat.key);
                          setShowCategoryPicker(false);
                        }}
                        className={`px-4 py-3 border-b border-gray-100 dark:border-gray-700 ${
                          formData.category === cat.key ? 'bg-secondary dark:bg-amber-900/30' : ''
                        }`}
                      >
                        <Text className={`${
                          formData.category === cat.key
                            ? 'text-primary dark:text-amber-400 font-semibold'
                            : 'text-gray-700 dark:text-gray-300'
                        }`}>
                          {cat.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Description
              </Text>
              <TextInput
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white h-24"
                placeholder="Describe your product..."
                placeholderTextColor="#9CA3AF"
                multiline
                textAlignVertical="top"
                value={formData.description}
                onChangeText={(v) => updateField('description', v)}
              />
            </View>

            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Image URL
              </Text>
              <View className="flex-row items-center">
                <View className="w-16 h-16 rounded-xl bg-gray-200 dark:bg-gray-700 items-center justify-center mr-3">
                  <ImageIcon size={24} color="#9CA3AF" />
                </View>
                <TextInput
                  className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white"
                  placeholder="https://example.com/image.jpg"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="url"
                  autoCapitalize="none"
                  value={formData.imageUrl}
                  onChangeText={(v) => updateField('imageUrl', v)}
                />
              </View>
            </View>
          </View>

          {/* Pricing */}
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Pricing
            </Text>

            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Price (USD) *
              </Text>
              <View className="flex-row items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3">
                <DollarSign size={18} color="#9CA3AF" />
                <TextInput
                  className="flex-1 ml-2 text-gray-900 dark:text-white"
                  placeholder="0.00"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="decimal-pad"
                  value={formData.priceUSD}
                  onChangeText={(v) => updateField('priceUSD', v)}
                />
              </View>
            </View>
          </View>

          {/* Inventory */}
          <View className="mb-6">
            <Text className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Inventory
            </Text>

            <View className="flex-row gap-4 mb-4">
              <View className="flex-1">
                <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  SKU
                </Text>
                <TextInput
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white"
                  placeholder="SKU-001"
                  placeholderTextColor="#9CA3AF"
                  value={formData.sku}
                  onChangeText={(v) => updateField('sku', v)}
                />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Quantity
                </Text>
                <View className="flex-row items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3">
                  <Package size={18} color="#9CA3AF" />
                  <TextInput
                    className="flex-1 ml-2 text-gray-900 dark:text-white"
                    placeholder="0"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="number-pad"
                    value={formData.quantity}
                    onChangeText={(v) => updateField('quantity', v)}
                  />
                </View>
              </View>
            </View>

            <View className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden">
              <View className="flex-row items-center justify-between px-4 py-4 border-b border-gray-100 dark:border-gray-700">
                <View className="flex-1">
                  <Text className="text-gray-900 dark:text-white font-medium">Track Inventory</Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-sm">
                    Show out of stock when quantity is 0
                  </Text>
                </View>
                <Switch
                  value={formData.trackInventory}
                  onValueChange={(v) => updateField('trackInventory', v)}
                  trackColor={{ false: '#D1D5DB', true: '#FCD34D' }}
                  thumbColor={formData.trackInventory ? '#FF6B00' : '#9CA3AF'}
                />
              </View>
              <View className="flex-row items-center justify-between px-4 py-4">
                <View className="flex-1">
                  <Text className="text-gray-900 dark:text-white font-medium">Allow Backorders</Text>
                  <Text className="text-gray-500 dark:text-gray-400 text-sm">
                    Continue selling when out of stock
                  </Text>
                </View>
                <Switch
                  value={formData.allowBackorder}
                  onValueChange={(v) => updateField('allowBackorder', v)}
                  trackColor={{ false: '#D1D5DB', true: '#FCD34D' }}
                  thumbColor={formData.allowBackorder ? '#FF6B00' : '#9CA3AF'}
                />
              </View>
            </View>
          </View>

          <View className="h-8" />
        </ScrollView>

        {/* Save Button */}
        <View className="px-5 py-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            className="bg-primary py-4 rounded-xl"
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-center text-white font-bold text-lg">Save Changes</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
