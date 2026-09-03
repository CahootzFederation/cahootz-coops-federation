import { useState } from 'react';
import { View, Text, TouchableOpacity, Image, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { getApiUrl, getCoopId } from '@/lib/config';

const API_BASE_URL = getApiUrl();

interface BlobPhotoUploadProps {
  onUploadComplete: (url: string) => void;
  uploadType: 'profile' | 'store' | 'product';
  resourceId?: string;
  title?: string;
  description?: string;
  aspectRatio?: [number, number];
}

export default function BlobPhotoUpload({
  onUploadComplete,
  uploadType,
  resourceId,
  title = "Upload Photo",
  description = "Select or take a photo",
  aspectRatio = [1, 1],
}: BlobPhotoUploadProps) {
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const pickPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow access to your media library');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: aspectRatio,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking photo:', error);
      Alert.alert('Error', 'Failed to pick photo');
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow camera access');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: aspectRatio,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo');
    }
  };

  const uploadPhoto = async () => {
    if (!photoUri) {
      Alert.alert('No photo selected', 'Please take or select a photo first');
      return;
    }

    setIsUploading(true);

    try {
      // Get file info from URI
      const filename = photoUri.split('/').pop() || 'photo.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';

      // Step 1: Get client upload token from API
      const tokenResponse = await fetch(`${API_BASE_URL}/api/upload/presigned`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Coop-Id': getCoopId(),
        },
        body: JSON.stringify({
          filename,
          contentType: type,
          uploadType,
          resourceId: resourceId || 'temp',
        }),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenData.success) {
        throw new Error(tokenData.error || 'Failed to get upload token');
      }

      // Step 2: Upload directly to Vercel Blob using client token
      const fileResponse = await fetch(photoUri);
      const fileBlob = await fileResponse.blob();

      const uploadResponse = await fetch(tokenData.uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tokenData.clientToken}`,
          'x-api-version': '7',
          'x-content-type': type,
        },
        body: fileBlob,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status: ${uploadResponse.status}`);
      }

      const blobResult = await uploadResponse.json();

      Alert.alert(
        'Success!',
        'Your photo has been uploaded',
        [
          {
            text: 'OK',
            onPress: () => onUploadComplete(blobResult.url),
          },
        ]
      );
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert('Upload failed', error instanceof Error ? error.message : 'Please try again');
    } finally {
      setIsUploading(false);
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
          {description}
        </Text>
      </View>

      {/* Photo preview */}
      {photoUri ? (
        <View className="space-y-3">
          <View className="rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 items-center p-4">
            <Image
              source={{ uri: photoUri }}
              style={{ width: 200, height: 200 }}
              className="rounded-lg"
              resizeMode="cover"
            />
          </View>
          <TouchableOpacity
            onPress={() => setPhotoUri(null)}
            className="bg-gray-200 dark:bg-gray-700 px-3 py-2 rounded-lg items-center"
          >
            <Text className="text-sm text-gray-700 dark:text-gray-300">Remove Photo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* Take/Select buttons */
        <View className="space-y-2">
          <TouchableOpacity
            onPress={takePhoto}
            className="bg-primary flex-row items-center justify-center py-4 rounded-xl"
          >
            <Ionicons name="camera" size={20} color="white" />
            <Text className="text-white font-semibold ml-2">Take Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={pickPhoto}
            className="bg-gray-200 dark:bg-gray-700 flex-row items-center justify-center py-4 rounded-xl"
          >
            <Ionicons name="images" size={20} color="#374151" />
            <Text className="text-gray-700 dark:text-gray-300 font-semibold ml-2">Choose from Library</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Upload button */}
      {photoUri && !isUploading && (
        <TouchableOpacity
          onPress={uploadPhoto}
          className="bg-green-600 flex-row items-center justify-center py-4 rounded-xl"
        >
          <Ionicons name="cloud-upload" size={20} color="white" />
          <Text className="text-white font-semibold ml-2">Upload Photo</Text>
        </TouchableOpacity>
      )}

      {/* Upload progress */}
      {isUploading && (
        <View className="bg-secondary dark:bg-amber-900/30 p-4 rounded-xl">
          <View className="flex-row items-center justify-center">
            <ActivityIndicator size="small" color="#FF8A2A" />
            <Text className="text-primary dark:text-amber-400 ml-2">Uploading...</Text>
          </View>
        </View>
      )}
    </View>
  );
}
