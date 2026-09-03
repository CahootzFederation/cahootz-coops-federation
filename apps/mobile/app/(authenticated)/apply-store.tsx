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
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  ArrowLeft,
  Store,
  User,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  BadgeCheck,
  Image as ImageIcon,
  X,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import BlobPhotoUpload from '@/components/blob-photo-upload';

type Step = 'store' | 'owner' | 'review';

export default function ApplyStoreScreen() {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState<Step>('store');
  const [loading, setLoading] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [storeCategories, setStoreCategories] = useState<{ key: string; label: string }[]>([]);

  // Form data
  const [formData, setFormData] = useState({
    storeName: '',
    storeDescription: '',
    category: '',
    storeImageUrl: '',
    storeBannerUrl: '',
    ownerName: user?.name || '',
    ownerEmail: user?.email || '',
    ownerPhone: user?.phone || '',
    websiteUrl: '',
  });

  const [showImageUpload, setShowImageUpload] = useState(false);
  const [showBannerUpload, setShowBannerUpload] = useState(false);

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const steps: { key: Step; label: string; icon: any }[] = [
    { key: 'store', label: 'Store', icon: Store },
    { key: 'owner', label: 'Owner', icon: User },
    { key: 'review', label: 'Review', icon: CheckCircle2 },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === currentStep);

  React.useEffect(() => {
    const loadCategories = async () => {
      try {
        const categories = await api.getStoreCategories(false);
        setStoreCategories(categories);
      } catch (error) {
        console.error('Failed to load store categories:', error);
      }
    };
    loadCategories();
  }, []);

  const validateStep = (): boolean => {
    switch (currentStep) {
      case 'store':
        if (!formData.storeName.trim()) {
          Alert.alert('Required', 'Please enter your store name');
          return false;
        }
        if (!formData.category) {
          Alert.alert('Required', 'Please select a category');
          return false;
        }
        if (!formData.storeDescription.trim() || formData.storeDescription.length < 10) {
          Alert.alert('Required', 'Please describe what your store offers (at least 10 characters)');
          return false;
        }
        return true;
      case 'owner':
        if (!formData.ownerName.trim() || !formData.ownerEmail.trim() || !formData.ownerPhone.trim()) {
          Alert.alert('Required', 'Please enter all owner information');
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  const nextStep = () => {
    if (!validateStep()) return;
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].key);
    }
  };

  const prevStep = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].key);
    }
  };

  const handleSubmit = async () => {
    if (!user?.walletAddress) {
      Alert.alert('Error', 'Please ensure you have a wallet address');
      return;
    }

    setLoading(true);
    try {
      let websiteUrl = formData.websiteUrl?.trim();
      if (websiteUrl && !websiteUrl.startsWith('http://') && !websiteUrl.startsWith('https://')) {
        websiteUrl = `https://${websiteUrl}`;
      }

      const result = await api.applyForStore({
        storeName: formData.storeName,
        storeDescription: formData.storeDescription,
        category: formData.category,
        imageUrl: formData.storeImageUrl || undefined,
        bannerUrl: formData.storeBannerUrl || undefined,
        ownerName: formData.ownerName,
        ownerEmail: formData.ownerEmail,
        ownerPhone: formData.ownerPhone,
        websiteUrl: websiteUrl || undefined,
      }, user.walletAddress);

      Alert.alert(
        'Application Submitted',
        'Your store application has been submitted. Complete Stripe Connect to activate your store.',
        [{ text: 'Continue' }],
      );

      router.replace({
        pathname: '/stripe-onboarding',
        params: { storeId: result.storeId },
      });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to submit application');
    } finally {
      setLoading(false);
    }
  };

  const getCategoryLabel = (value: string) => {
    return storeCategories.find((c) => c.key === value)?.label || 'Select Category';
  };

  const renderStoreStep = () => (
    <View className="px-5">
      <Text className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Store Information
      </Text>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Store Name *</Text>
        <TextInput
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white"
          placeholder="Enter your store name"
          placeholderTextColor="#9CA3AF"
          value={formData.storeName}
          onChangeText={(v) => updateField('storeName', v)}
        />
      </View>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Category *</Text>
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
          <View className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl mt-2 overflow-hidden">
            {storeCategories.map((cat) => (
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
                <Text className={
                  formData.category === cat.key
                    ? 'text-primary dark:text-amber-400 font-semibold'
                    : 'text-gray-700 dark:text-gray-300'
                }>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          What does your store offer? *
        </Text>
        <TextInput
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white h-24"
          placeholder="Describe the products or services your store will offer..."
          placeholderTextColor="#9CA3AF"
          multiline
          textAlignVertical="top"
          value={formData.storeDescription}
          onChangeText={(v) => updateField('storeDescription', v)}
        />
        <Text className="text-xs text-gray-500 mt-1">
          {formData.storeDescription.length}/10 minimum characters
        </Text>
      </View>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Store Image (Optional)
        </Text>
        {formData.storeImageUrl ? (
          <View className="relative">
            <Image
              source={{ uri: formData.storeImageUrl }}
              style={{ width: '100%', height: 150 }}
              className="rounded-xl"
              resizeMode="cover"
            />
            <TouchableOpacity
              onPress={() => updateField('storeImageUrl', '')}
              className="absolute top-2 right-2 bg-red-500 rounded-full p-2"
            >
              <X size={16} color="white" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setShowImageUpload(true)}
            className="bg-white dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-4 items-center"
          >
            <ImageIcon size={24} color="#9CA3AF" />
            <Text className="text-gray-600 dark:text-gray-400 text-sm mt-1">Tap to upload store image</Text>
          </TouchableOpacity>
        )}
      </View>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Store Banner (Optional)
        </Text>
        {formData.storeBannerUrl ? (
          <View className="relative">
            <Image
              source={{ uri: formData.storeBannerUrl }}
              style={{ width: '100%', height: 100 }}
              className="rounded-xl"
              resizeMode="cover"
            />
            <TouchableOpacity
              onPress={() => updateField('storeBannerUrl', '')}
              className="absolute top-2 right-2 bg-red-500 rounded-full p-2"
            >
              <X size={16} color="white" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setShowBannerUpload(true)}
            className="bg-white dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-4 items-center"
          >
            <ImageIcon size={24} color="#9CA3AF" />
            <Text className="text-gray-600 dark:text-gray-400 text-sm mt-1">Tap to upload banner</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderOwnerStep = () => (
    <View className="px-5">
      <Text className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Your Information
      </Text>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Full Name *</Text>
        <TextInput
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white"
          placeholder="Your full name"
          placeholderTextColor="#9CA3AF"
          value={formData.ownerName}
          onChangeText={(v) => updateField('ownerName', v)}
        />
      </View>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email *</Text>
        <TextInput
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white"
          placeholder="your@email.com"
          placeholderTextColor="#9CA3AF"
          keyboardType="email-address"
          autoCapitalize="none"
          value={formData.ownerEmail}
          onChangeText={(v) => updateField('ownerEmail', v)}
        />
      </View>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Phone *</Text>
        <TextInput
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white"
          placeholder="(555) 555-5555"
          placeholderTextColor="#9CA3AF"
          keyboardType="phone-pad"
          value={formData.ownerPhone}
          onChangeText={(v) => updateField('ownerPhone', v)}
        />
      </View>

      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Website (Optional)
        </Text>
        <TextInput
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white"
          placeholder="yourwebsite.com"
          placeholderTextColor="#9CA3AF"
          keyboardType="url"
          autoCapitalize="none"
          value={formData.websiteUrl}
          onChangeText={(v) => updateField('websiteUrl', v)}
        />
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          We&apos;ll add https:// if needed
        </Text>
      </View>
    </View>
  );

  const renderReviewStep = () => (
    <View className="px-5">
      <Text className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Review Your Application
      </Text>

      <View className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-primary dark:text-amber-400 mb-2">
          Store Information
        </Text>
        <Text className="text-gray-900 dark:text-white font-medium">{formData.storeName}</Text>
        <Text className="text-gray-500 dark:text-gray-400 text-sm">
          {getCategoryLabel(formData.category)}
        </Text>
        <Text className="text-gray-600 dark:text-gray-300 text-sm mt-1">
          {formData.storeDescription}
        </Text>
      </View>

      <View className="bg-white dark:bg-gray-800 rounded-xl p-4 mb-4">
        <Text className="text-sm font-semibold text-primary dark:text-amber-400 mb-2">
          Your Information
        </Text>
        <Text className="text-gray-900 dark:text-white font-medium">{formData.ownerName}</Text>
        <Text className="text-gray-500 dark:text-gray-400 text-sm">{formData.ownerEmail}</Text>
        <Text className="text-gray-500 dark:text-gray-400 text-sm">{formData.ownerPhone}</Text>
      </View>

      <View className="bg-secondary dark:bg-amber-900/30 rounded-xl p-4 mb-4">
        <View className="flex-row items-center mb-2">
          <BadgeCheck size={20} color="#FF6B00" />
          <Text className="text-amber-800 dark:text-amber-200 font-semibold ml-2">
            What Happens Next
          </Text>
        </View>
        <Text className="text-primary dark:text-amber-300 text-sm">
          After submitting, you&apos;ll complete Stripe Connect to verify your identity and set up payouts. Your store goes live as soon as Stripe enables charges.
        </Text>
      </View>
    </View>
  );

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
            Open a Store
          </Text>
          <View className="w-6" />
        </View>

        {/* Progress Steps */}
        <View className="bg-white dark:bg-gray-800 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <View className="flex-row items-center justify-between">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = index === currentStepIndex;
              const isCompleted = index < currentStepIndex;

              return (
                <React.Fragment key={step.key}>
                  <View className="items-center">
                    <View
                      className={`w-10 h-10 rounded-full items-center justify-center ${
                        isActive
                          ? 'bg-primary'
                          : isCompleted
                          ? 'bg-green-500'
                          : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 size={20} color="white" />
                      ) : (
                        <Icon size={18} color={isActive ? 'white' : '#9CA3AF'} />
                      )}
                    </View>
                    <Text
                      className={`text-xs mt-1 ${
                        isActive
                          ? 'text-primary dark:text-amber-400 font-semibold'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {step.label}
                    </Text>
                  </View>
                  {index < steps.length - 1 && (
                    <View
                      className={`flex-1 h-0.5 mx-2 ${
                        index < currentStepIndex
                          ? 'bg-green-500'
                          : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </View>
        </View>

        {/* Content */}
        <ScrollView className="flex-1 py-4" showsVerticalScrollIndicator={false}>
          {currentStep === 'store' && renderStoreStep()}
          {currentStep === 'owner' && renderOwnerStep()}
          {currentStep === 'review' && renderReviewStep()}
        </ScrollView>

        {/* Navigation Buttons */}
        <View className="px-5 py-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
          <View className="flex-row gap-3">
            {currentStepIndex > 0 && (
              <TouchableOpacity
                onPress={prevStep}
                className="flex-1 bg-gray-100 dark:bg-gray-700 py-4 rounded-xl"
              >
                <Text className="text-center text-gray-700 dark:text-gray-300 font-semibold">Back</Text>
              </TouchableOpacity>
            )}
            {currentStep === 'review' ? (
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={loading}
                className="flex-1 bg-primary py-4 rounded-xl"
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-center text-white font-bold">Create Store</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={nextStep}
                className="flex-1 bg-primary py-4 rounded-xl flex-row items-center justify-center"
              >
                <Text className="text-white font-bold mr-2">Continue</Text>
                <ChevronRight size={20} color="white" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Image Upload Modal */}
        {showImageUpload && (
          <View className="absolute inset-0 bg-black/50 justify-center items-center px-5">
            <View className="bg-white dark:bg-gray-800 rounded-xl p-5 w-full max-w-md">
              <View className="flex-row justify-between items-center mb-4">
                <Text className="text-lg font-semibold text-gray-900 dark:text-white">
                  Upload Store Image
                </Text>
                <TouchableOpacity onPress={() => setShowImageUpload(false)}>
                  <X size={24} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
              <BlobPhotoUpload
                uploadType="store"
                resourceId="temp"
                onUploadComplete={(url) => {
                  updateField('storeImageUrl', url);
                  setShowImageUpload(false);
                }}
                title="Store Image"
                description="Upload your store logo or main image"
                aspectRatio={[1, 1]}
              />
            </View>
          </View>
        )}

        {/* Banner Upload Modal */}
        {showBannerUpload && (
          <View className="absolute inset-0 bg-black/50 justify-center items-center px-5">
            <View className="bg-white dark:bg-gray-800 rounded-xl p-5 w-full max-w-md">
              <View className="flex-row justify-between items-center mb-4">
                <Text className="text-lg font-semibold text-gray-900 dark:text-white">
                  Upload Store Banner
                </Text>
                <TouchableOpacity onPress={() => setShowBannerUpload(false)}>
                  <X size={24} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
              <BlobPhotoUpload
                uploadType="store"
                resourceId="temp"
                onUploadComplete={(url) => {
                  updateField('storeBannerUrl', url);
                  setShowBannerUpload(false);
                }}
                title="Store Banner"
                description="Upload a wide banner image for your store"
                aspectRatio={[16, 9]}
              />
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
