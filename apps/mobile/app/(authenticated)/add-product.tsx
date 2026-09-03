import React, { useState } from 'react';
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
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  ChevronDown,
  Image as ImageIcon,
  DollarSign,
  Package,
  X,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import BlobPhotoUpload from '@/components/blob-photo-upload';
import BlobMultiPhotoUpload from '@/components/blob-multi-photo-upload';

export default function AddProductScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams();
  const storeId = params.storeId as string | undefined;
  
  const [loading, setLoading] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [productCategories, setProductCategories] = useState<{ key: string; label: string; isAdminOnly: boolean }[]>([]);

  // Form data
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: '',
    imageUrl: '',
    images: [] as string[],
    priceUSD: '',
    sku: '',
    quantity: '0',
    trackInventory: true,
    allowBackorder: false,
  });
  
  const [showImageUpload, setShowImageUpload] = useState(false);
  const [showGalleryUpload, setShowGalleryUpload] = useState(false);

  const updateField = (field: string, value: string | boolean | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Load product categories on mount (exclude admin-only for regular users)
  React.useEffect(() => {
    const loadCategories = async () => {
      try {
        const categories = await api.getProductCategories(false); // Exclude admin-only categories
        setProductCategories(categories);
      } catch (error) {
        console.error('Failed to load product categories:', error);
      }
    };
    loadCategories();
  }, []);

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

  const handleSubmit = async () => {
    if (!validateForm()) return;
    if (!user?.walletAddress) {
      Alert.alert('Error', 'Please ensure you are logged in');
      return;
    }
    if (!storeId) {
      Alert.alert('Error', 'Store ID is required');
      return;
    }

    setLoading(true);
    try {
      const result = await api.addProduct({
        storeId,
        name: formData.name,
        description: formData.description || undefined,
        category: formData.category,
        imageUrl: formData.imageUrl || undefined,
        images: formData.images.length > 0 ? formData.images : undefined,
        priceUSD: parseFloat(formData.priceUSD),
        sku: formData.sku || undefined,
        quantity: parseInt(formData.quantity) || 0,
        trackInventory: formData.trackInventory,
        allowBackorder: formData.allowBackorder,
      }, user.walletAddress);

      console.log('Product added successfully:', result);

      // Navigate back first, then show alert
      router.back();

      // Show success message after navigation
      setTimeout(() => {
        Alert.alert('Success', 'Product added successfully!');
      }, 100);
    } catch (error: any) {
      console.error('Add product error:', error);
      Alert.alert('Error', error.message || 'Failed to add product');
      setLoading(false);
    }
  };

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
            Add Product
          </Text>
          <View className="w-6" />
        </View>

        <ScrollView className="flex-1 px-5 py-4" showsVerticalScrollIndicator={false}>
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
                    {productCategories
                      .filter((cat) => !cat.isAdminOnly) // Filter out admin-only categories for creation
                      .map((cat) => (
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

            {/* Primary Image */}
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Primary Image
              </Text>
              {formData.imageUrl ? (
                <View className="relative">
                  <Image
                    source={{ uri: formData.imageUrl }}
                    style={{ width: '100%', height: 200 }}
                    className="rounded-xl"
                    resizeMode="cover"
                  />
                  <TouchableOpacity
                    onPress={() => updateField('imageUrl', '')}
                    className="absolute top-2 right-2 bg-red-500 rounded-full p-2"
                  >
                    <X size={16} color="white" />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => setShowImageUpload(true)}
                  className="bg-gray-100 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 items-center"
                >
                  <ImageIcon size={32} color="#9CA3AF" />
                  <Text className="text-gray-600 dark:text-gray-400 mt-2">Tap to upload image</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Additional Images Gallery */}
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Additional Images (Optional)
              </Text>
              {formData.images.length > 0 ? (
                <View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
                    {formData.images.map((url, index) => (
                      <View key={index} className="mr-2 relative">
                        <Image
                          source={{ uri: url }}
                          style={{ width: 80, height: 80 }}
                          className="rounded-lg"
                          resizeMode="cover"
                        />
                        <TouchableOpacity
                          onPress={() => {
                            const newImages = formData.images.filter((_, i) => i !== index);
                            updateField('images', newImages);
                          }}
                          className="absolute -top-1 -right-1 bg-red-500 rounded-full p-1"
                        >
                          <X size={12} color="white" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                  <TouchableOpacity
                    onPress={() => setShowGalleryUpload(true)}
                    className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg py-2 items-center"
                  >
                    <Text className="text-gray-600 dark:text-gray-400 text-sm">Add more images</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => setShowGalleryUpload(true)}
                  className="bg-gray-100 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-4 items-center"
                >
                  <ImageIcon size={24} color="#9CA3AF" />
                  <Text className="text-gray-600 dark:text-gray-400 text-sm mt-1">Tap to upload gallery</Text>
                </TouchableOpacity>
              )}
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
                  SKU (Optional)
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

        </ScrollView>

        {/* Submit Button */}
        <View className="px-5 py-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={loading}
            className="bg-primary py-4 rounded-xl"
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-center text-white font-bold text-lg">Add Product</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Image Upload Modal */}
        {showImageUpload && (
          <View className="absolute inset-0 bg-black/50 justify-center items-center px-5">
            <View className="bg-white dark:bg-gray-800 rounded-xl p-5 w-full max-w-md">
              <View className="flex-row justify-between items-center mb-4">
                <Text className="text-lg font-semibold text-gray-900 dark:text-white">
                  Upload Primary Image
                </Text>
                <TouchableOpacity onPress={() => setShowImageUpload(false)}>
                  <X size={24} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
              <BlobPhotoUpload
                uploadType="product"
                resourceId={storeId}
                onUploadComplete={(url) => {
                  updateField('imageUrl', url);
                  setShowImageUpload(false);
                }}
                title="Product Image"
                description="Upload a clear photo of your product"
                aspectRatio={[4, 3]}
              />
            </View>
          </View>
        )}

        {/* Gallery Upload Modal */}
        {showGalleryUpload && (
          <View className="absolute inset-0 bg-black/50 justify-center items-center px-5">
            <View className="bg-white dark:bg-gray-800 rounded-xl p-5 w-full max-w-md">
              <View className="flex-row justify-between items-center mb-4">
                <Text className="text-lg font-semibold text-gray-900 dark:text-white">
                  Upload Gallery Images
                </Text>
                <TouchableOpacity onPress={() => setShowGalleryUpload(false)}>
                  <X size={24} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
              <BlobMultiPhotoUpload
                uploadType="product"
                resourceId={storeId}
                maxImages={5}
                onUploadComplete={(urls) => {
                  updateField('images', [...formData.images, ...urls]);
                  setShowGalleryUpload(false);
                }}
                title="Product Gallery"
                description="Upload multiple product images"
              />
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
