import { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { getCoopId } from '@/lib/config';

interface VideoUploadProps {
  onUploadComplete: (cid: string, url: string) => void;
  apiUrl: string;
  resourceId?: string;
}

export default function VideoUpload({ onUploadComplete, apiUrl, resourceId = "temp" }: VideoUploadProps) {
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);

  const player = useVideoPlayer(videoUri, (p) => {
    p.loop = true;
  });

  const pickVideo = async () => {
    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow access to your media library');
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'videos',
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 10,
      });

      if (!result.canceled && result.assets[0]) {
        const video = result.assets[0];

        // Check duration (5-10 seconds required)
        const duration = video.duration ? video.duration / 1000 : 0;

        if (duration < 5) {
          Alert.alert('Video too short', 'Please record a video between 5-10 seconds');
          return;
        }

        if (duration > 10) {
          Alert.alert('Video too long', 'Please record a video between 5-10 seconds');
          return;
        }

        setVideoUri(video.uri);
        setVideoDuration(duration);
      }
    } catch (error) {
      console.error('Error picking video:', error);
      Alert.alert('Error', 'Failed to pick video');
    }
  };

  const recordVideo = async () => {
    try {
      // Request camera permission
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow camera access');
        return;
      }

      // Launch camera
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: 'videos',
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 10,
      });

      if (!result.canceled && result.assets[0]) {
        const video = result.assets[0];

        const duration = video.duration ? video.duration / 1000 : 0;

        if (duration < 5) {
          Alert.alert('Video too short', 'Please record a video between 5-10 seconds');
          return;
        }

        if (duration > 10) {
          Alert.alert('Video too long', 'Please record a video between 5-10 seconds');
          return;
        }

        setVideoUri(video.uri);
        setVideoDuration(duration);
      }
    } catch (error) {
      console.error('Error recording video:', error);
      Alert.alert('Error', 'Failed to record video');
    }
  };

  const uploadVideo = async () => {
    if (!videoUri) {
      Alert.alert('No video selected', 'Please record or select a video first');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Get file info from URI
      const filename = videoUri.split('/').pop() || 'intro-video.mp4';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `video/${match[1]}` : 'video/mp4';

      // Step 1: Get client upload token from API
      const tokenResponse = await fetch(`${apiUrl}/api/upload/presigned`, {
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

      const tokenData = await tokenResponse.json();

      if (!tokenData.success) {
        throw new Error(tokenData.error || 'Failed to get upload token');
      }

      setUploadProgress(30);

      // Step 2: Upload directly to Vercel Blob using client token
      const fileResponse = await fetch(videoUri);
      const fileBlob = await fileResponse.blob();

      setUploadProgress(50);

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

      setUploadProgress(100);

      Alert.alert(
        'Success!',
        'Your introduction video has been uploaded',
        [
          {
            text: 'OK',
            onPress: () => onUploadComplete(tokenData.pathname, blobResult.url),
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
          Introduction Video
        </Text>
        <Text className="text-sm text-gray-600">
          Record a 5-10 second video introducing yourself to the commons
        </Text>
      </View>

      {/* Video preview */}
      {videoUri ? (
        <View className="space-y-3">
          <View className="rounded-xl overflow-hidden bg-gray-100">
            <VideoView
              player={player}
              style={{ width: '100%', height: 200 }}
              nativeControls
              contentFit="contain"
            />
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-gray-600">
              Duration: {videoDuration?.toFixed(1)}s
            </Text>
            <TouchableOpacity
              onPress={() => setVideoUri(null)}
              className="bg-gray-200 px-3 py-2 rounded-lg"
            >
              <Text className="text-sm text-gray-700">Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* Record/Select buttons */
        <View className="space-y-2">
          <TouchableOpacity
            onPress={recordVideo}
            className="bg-amber-500 flex-row items-center justify-center py-4 rounded-xl"
          >
            <Ionicons name="videocam" size={20} color="white" />
            <Text className="text-white font-semibold ml-2">Record Video</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={pickVideo}
            className="bg-gray-200 flex-row items-center justify-center py-4 rounded-xl"
          >
            <Ionicons name="folder-open" size={20} color="#374151" />
            <Text className="text-gray-700 font-semibold ml-2">Choose from Library</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Upload button */}
      {videoUri && !isUploading && (
        <TouchableOpacity
          onPress={uploadVideo}
          className="bg-green-600 flex-row items-center justify-center py-4 rounded-xl"
        >
          <Ionicons name="cloud-upload" size={20} color="white" />
          <Text className="text-white font-semibold ml-2">Upload Video</Text>
        </TouchableOpacity>
      )}

      {/* Upload progress */}
      {isUploading && (
        <View className="bg-amber-50 p-4 rounded-xl space-y-2">
          <View className="flex-row items-center justify-center">
            <ActivityIndicator size="small" color="#D97706" />
            <Text className="text-amber-700 ml-2">Uploading...</Text>
          </View>
          {uploadProgress > 0 && (
            <View className="bg-amber-200 h-2 rounded-full overflow-hidden">
              <View
                className="bg-amber-600 h-full"
                style={{ width: `${uploadProgress}%` }}
              />
            </View>
          )}
        </View>
      )}

      {/* Tips */}
      <View className="bg-gray-50 p-3 rounded-lg">
        <Text className="text-xs text-gray-600 font-semibold mb-1">Tips for a great video:</Text>
        <Text className="text-xs text-gray-600">• Find good lighting</Text>
        <Text className="text-xs text-gray-600">• Look at the camera</Text>
        <Text className="text-xs text-gray-600">• Keep it between 5-10 seconds</Text>
        <Text className="text-xs text-gray-600">• Introduce yourself and why you want to join</Text>
      </View>
    </View>
  );
}
