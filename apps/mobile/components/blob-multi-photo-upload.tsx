import { useState } from 'react';
import { View, Text, TouchableOpacity, Image, Alert, ActivityIndicator, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { getApiUrl, getCoopId } from '@/lib/config';

const API_BASE_URL = getApiUrl();

interface BlobMultiPhotoUploadProps {
  onUploadComplete: (urls: string[]) => void;
  uploadType?: 'product';
  resourceId?: string;
  maxImages?: number;
  title?: string;
  description?: string;
}

interface UploadProgress {
  uri: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  url?: string;
  error?: string;
}

export default function BlobMultiPhotoUpload({
  onUploadComplete,
  uploadType = 'product',
  resourceId,
  maxImages = 5,
  title = "Upload Photos",
  description = "Select multiple photos for your product gallery",
}: BlobMultiPhotoUploadProps) {
  const [photos, setPhotos] = useState<UploadProgress[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const pickPhotos = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow access to your media library');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
        selectionLimit: maxImages,
      });

      if (!result.canceled && result.assets.length > 0) {
        const newPhotos: UploadProgress[] = result.assets.map(asset => ({
          uri: asset.uri,
          status: 'pending',
        }));
        setPhotos(newPhotos);
      }
    } catch (error) {
      console.error('Error picking photos:', error);
      Alert.alert('Error', 'Failed to pick photos');
    }
  };

  const removePhoto = (uri: string) => {
    setPhotos(prev => prev.filter(p => p.uri !== uri));
  };

  const uploadPhotos = async () => {
    if (photos.length === 0) {
      Alert.alert('No photos selected', 'Please select photos first');
      return;
    }

    setIsUploading(true);

    try {
      // Step 1: Get batch upload tokens from API
      const tokenResponse = await fetch(`${API_BASE_URL}/api/upload/presigned-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Coop-Id': getCoopId(),
        },
        body: JSON.stringify({
          count: photos.length,
          contentType: 'image/jpeg',
          uploadType,
          resourceId: resourceId || 'temp',
        }),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenData.success) {
        throw new Error(tokenData.error || 'Failed to get upload tokens');
      }

      // Step 2: Upload all photos in parallel directly to Vercel Blob
      const uploadPromises = photos.map(async (photo, index) => {
        try {
          setPhotos(prev => prev.map((p, i) =>
            i === index ? { ...p, status: 'uploading' as const } : p
          ));

          const uploadInfo = tokenData.uploads[index];

          const fileResponse = await fetch(photo.uri);
          const fileBlob = await fileResponse.blob();

          const uploadResponse = await fetch(uploadInfo.uploadUrl, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${uploadInfo.clientToken}`,
              'x-api-version': '7',
              'x-content-type': 'image/jpeg',
            },
            body: fileBlob,
          });

          if (!uploadResponse.ok) {
            throw new Error(`Upload failed with status: ${uploadResponse.status}`);
          }

          const blobResult = await uploadResponse.json();
          const publicUrl = blobResult.url;

          setPhotos(prev => prev.map((p, i) =>
            i === index ? { ...p, status: 'success' as const, url: publicUrl } : p
          ));

          return publicUrl;
        } catch (error) {
          // Update status to error
          setPhotos(prev => prev.map((p, i) => 
            i === index ? { 
              ...p, 
              status: 'error' as const, 
              error: error instanceof Error ? error.message : 'Upload failed' 
            } : p
          ));
          throw error;
        }
      });

      // Wait for all uploads to complete
      const uploadedUrls = await Promise.all(uploadPromises);

      Alert.alert(
        'Success!',
        `${uploadedUrls.length} photo(s) uploaded successfully`,
        [
          {
            text: 'OK',
            onPress: () => onUploadComplete(uploadedUrls),
          },
        ]
      );
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert('Upload failed', 'Some photos failed to upload. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusIcon = (status: UploadProgress['status']) => {
    switch (status) {
      case 'pending':
        return <Ionicons name="ellipse-outline" size={16} color="#9CA3AF" />;
      case 'uploading':
        return <ActivityIndicator size="small" color="#FF8A2A" />;
      case 'success':
        return <Ionicons name="checkmark-circle" size={16} color="#10B981" />;
      case 'error':
        return <Ionicons name="close-circle" size={16} color="#EF4444" />;
    }
  };

  return (
    <View className="space-y-4">
      {/* Title and instructions */}
      <View>
        <Text className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          {title}
        </Text>
        <Text className="text-sm text-gray-600 dark:text-gray-400">
          {description} (max {maxImages})
        </Text>
      </View>

      {/* Photos preview */}
      {photos.length > 0 ? (
        <View className="space-y-3">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
            {photos.map((photo, index) => (
              <View key={index} className="mr-3 relative">
                <Image
                  source={{ uri: photo.uri }}
                  style={{ width: 100, height: 100 }}
                  className="rounded-lg"
                  resizeMode="cover"
                />
                {/* Status indicator */}
                <View className="absolute top-1 right-1 bg-white dark:bg-gray-800 rounded-full p-1">
                  {getStatusIcon(photo.status)}
                </View>
                {/* Remove button */}
                {photo.status === 'pending' && (
                  <TouchableOpacity
                    onPress={() => removePhoto(photo.uri)}
                    className="absolute bottom-1 right-1 bg-red-500 rounded-full p-1"
                  >
                    <Ionicons name="close" size={12} color="white" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </ScrollView>

          {/* Clear all button */}
          {!isUploading && (
            <TouchableOpacity
              onPress={() => setPhotos([])}
              className="bg-gray-200 dark:bg-gray-700 px-3 py-2 rounded-lg items-center"
            >
              <Text className="text-sm text-gray-700 dark:text-gray-300">Clear All</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        /* Select button */
        <TouchableOpacity
          onPress={pickPhotos}
          className="bg-primary flex-row items-center justify-center py-4 rounded-xl"
        >
          <Ionicons name="images" size={20} color="white" />
          <Text className="text-white font-semibold ml-2">Select Photos</Text>
        </TouchableOpacity>
      )}

      {/* Upload button */}
      {photos.length > 0 && !isUploading && (
        <TouchableOpacity
          onPress={uploadPhotos}
          className="bg-green-600 flex-row items-center justify-center py-4 rounded-xl"
        >
          <Ionicons name="cloud-upload" size={20} color="white" />
          <Text className="text-white font-semibold ml-2">
            Upload {photos.length} Photo{photos.length > 1 ? 's' : ''}
          </Text>
        </TouchableOpacity>
      )}

      {/* Upload progress */}
      {isUploading && (
        <View className="bg-secondary dark:bg-amber-900/30 p-4 rounded-xl">
          <View className="flex-row items-center justify-center mb-2">
            <ActivityIndicator size="small" color="#FF8A2A" />
            <Text className="text-primary dark:text-amber-400 ml-2">Uploading photos...</Text>
          </View>
          <Text className="text-xs text-primary dark:text-amber-500 text-center">
            {photos.filter(p => p.status === 'success').length} of {photos.length} completed
          </Text>
        </View>
      )}
    </View>
  );
}
