import { Modal, TouchableOpacity, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { X } from 'lucide-react-native';

import type { CommonsPostMedia } from '@/lib/api';

export type CommonsMediaPreview = Pick<
  CommonsPostMedia,
  'mediaType' | 'mimeType' | 'fileName' | 'width' | 'height' | 'durationMs' | 'sizeBytes'
> &
  Partial<Pick<CommonsPostMedia, 'id' | 'pathname' | 'url'>> & {
    uri?: string;
  };

export const COMPOSER_MEDIA_TILE_SIZE = 92;
export const FEED_MEDIA_TILE_SIZE = 132;

function mediaUri(media: CommonsMediaPreview) {
  return media.uri || media.url || '';
}

function VideoPreview({
  uri,
  nativeControls,
  size,
}: {
  uri: string;
  nativeControls: boolean;
  size: number;
}) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
  });

  return (
    <VideoView
      player={player}
      nativeControls={nativeControls}
      contentFit="cover"
      style={{ width: size, height: size, borderRadius: 8, backgroundColor: '#111827' }}
    />
  );
}

function FullscreenVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.play();
  });

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={{ width: '100%', height: '100%', backgroundColor: '#000000' }}
    />
  );
}

export function CommonsMediaTile({
  media,
  size = FEED_MEDIA_TILE_SIZE,
  nativeControls = false,
}: {
  media: CommonsMediaPreview;
  size?: number;
  nativeControls?: boolean;
}) {
  const uri = mediaUri(media);

  if (media.mediaType === 'video') {
    return <VideoPreview uri={uri} size={size} nativeControls={nativeControls} />;
  }

  return (
    <ExpoImage
      source={{ uri }}
      contentFit="cover"
      style={{ width: size, height: size, borderRadius: 8, backgroundColor: '#E5E7EB' }}
    />
  );
}

export function CommonsMediaViewer({
  media,
  onClose,
}: {
  media: CommonsMediaPreview | null;
  onClose: () => void;
}) {
  const uri = media ? mediaUri(media) : '';

  return (
    <Modal visible={!!media} animationType="fade" transparent onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        <TouchableOpacity
          onPress={onClose}
          className="absolute right-4 top-14 z-10 h-11 w-11 items-center justify-center rounded-full bg-white/15"
          accessibilityLabel="Close media viewer"
        >
          <X size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View className="flex-1 items-center justify-center">
          {media?.mediaType === 'video' ? (
            <FullscreenVideo uri={uri} />
          ) : (
            <ExpoImage
              source={{ uri }}
              contentFit="contain"
              style={{ width: '100%', height: '100%', backgroundColor: '#000000' }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
