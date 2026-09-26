import { Image as ExpoImage } from 'expo-image';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { personInitials } from '@/lib/social-profile';

/**
 * A member's personal-page avatar: their uploaded photo when set, otherwise
 * their chosen emoji on its color, otherwise initials on the neutral slate
 * square every person card used before avatars existed.
 */
export function PersonAvatar({
  name,
  avatarUrl,
  avatarEmoji,
  avatarColor,
  size = 56,
  radius,
}: {
  name: string;
  avatarUrl?: string | null;
  avatarEmoji?: string | null;
  avatarColor?: string | null;
  size?: number;
  radius?: number;
}) {
  const resolvedRadius = radius ?? Math.round(size * 0.3);

  if (avatarUrl) {
    return (
      <ExpoImage
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: resolvedRadius, backgroundColor: '#E2E8F0' }}
        contentFit="cover"
        accessibilityLabel={`${name}'s profile photo`}
      />
    );
  }

  return (
    <View
      className="items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: resolvedRadius,
        backgroundColor: avatarEmoji ? avatarColor || '#FF6B00' : '#E2E8F0',
      }}
    >
      {avatarEmoji ? (
        <Text style={{ fontSize: Math.round(size * 0.5) }}>{avatarEmoji}</Text>
      ) : (
        <Text style={{ fontSize: Math.round(size * 0.32), fontWeight: '900', color: '#334155' }}>
          {personInitials(name)}
        </Text>
      )}
    </View>
  );
}
