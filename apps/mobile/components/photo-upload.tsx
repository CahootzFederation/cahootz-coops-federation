import { useState } from 'react';
import { View, Text, TouchableOpacity, Image, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { getCoopId } from '@/lib/config';

interface PhotoUploadProps {
  onUploadComplete: (cid: string, url: string) => void;
  apiUrl: string;
  title?: string;
  description?: string;
  resourceId?: string;
}

export default function PhotoUpload({
  onUploadComplete,
  apiUrl,
  title = "Profile Photo",
  description = "Upload a clear photo of yourself",
  resourceId = "temp",
}: PhotoUploadProps) {
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const pickPhoto = async () => {
    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow access to your media library');
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1], // Square aspect ratio
        quality: 0.8, // Compress to reduce file size
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
      // Request camera permission
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow camera access');
        return;
      }

      // Launch camera
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
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
      const filename = photoUri.split('/').pop() || 'profile-photo.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';

      // Step 1: Get presigned URL from API
      const presignedResponse = await fetch(`${apiUrl}/api/upload/presigned`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Coop-Id': getCoopId(),
        },
        body: JSON.stringify({
          filename,
          contentType: type,
          uploadType: 'profile',
          resourceId,
        }),
      });

      const presignedData = await presignedResponse.json();

      if (!presignedData.success) {
        throw new Error(presignedData.error || 'Failed to get presigned URL');
      }

      // Step 2: Upload file directly to blob storage using the presigned URL
      const fileResponse = await fetch(photoUri);
      const fileBlob = await fileResponse.blob();

      const uploadResponse = await fetch(presignedData.presignedUrl, {
        method: 'PUT',
        body: fileBlob,
        headers: {
          'Content-Type': type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status: ${uploadResponse.status}`);
      }

      // Success! Return the public URL (using key as CID for backward compatibility)
      Alert.alert(
        'Success!',
        'Your photo has been uploaded',
        [
          {
            text: 'OK',
            onPress: () => onUploadComplete(presignedData.key, presignedData.publicUrl),
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
        <Text className="text-lg font-semibold text-gray-900 mb-1">
          {title}
        </Text>
        <Text className="text-sm text-gray-600">
          {description}
        </Text>
      </View>

      {/* Photo preview */}
      {photoUri ? (
        <View className="space-y-3">
          <View className="rounded-xl overflow-hidden bg-gray-100 items-center p-4">
            <Image
              source={{ uri: photoUri }}
              style={{ width: 200, height: 200 }}
              className="rounded-lg"
              resizeMode="cover"
            />
          </View>
          <TouchableOpacity
            onPress={() => setPhotoUri(null)}
            className="bg-gray-200 px-3 py-2 rounded-lg items-center"
          >
            <Text className="text-sm text-gray-700">Remove Photo</Text>
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
            className="bg-gray-200 flex-row items-center justify-center py-4 rounded-xl"
          >
            <Ionicons name="images" size={20} color="#374151" />
            <Text className="text-gray-700 font-semibold ml-2">Choose from Library</Text>
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
        <View className="bg-secondary p-4 rounded-xl">
          <View className="flex-row items-center justify-center">
            <ActivityIndicator size="small" color="#FF8A2A" />
            <Text className="text-primary ml-2">Uploading...</Text>
          </View>
        </View>
      )}

      {/* Tips */}
      <View className="bg-gray-50 p-3 rounded-lg">
        <Text className="text-xs text-gray-600 font-semibold mb-1">Tips for a good photo:</Text>
        <Text className="text-xs text-gray-600">• Use good lighting</Text>
        <Text className="text-xs text-gray-600">• Face the camera directly</Text>
        <Text className="text-xs text-gray-600">• Avoid sunglasses or hats</Text>
        <Text className="text-xs text-gray-600">• Clear, recent photo</Text>
      </View>
    </View>
  );
}
