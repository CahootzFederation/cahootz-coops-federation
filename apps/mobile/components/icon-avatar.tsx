import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { circleColorFromKey } from '@/lib/circle-color';

const DEFAULT_BG = '#FF6B00';

/**
 * Shared avatar for commons and circles: a Notion-style emoji-on-color square
 * when `emoji`/`color` are set, otherwise falls back to the existing
 * initial-on-color-hash look so every card stays consistent even before an
 * icon has been chosen.
 */
export function IconAvatar({
  emoji,
  color,
  foregroundColor,
  fallbackText,
  colorKey,
  size = 56,
  radius,
}: {
  emoji?: string | null;
  color?: string | null;
  /** Overrides the auto white-on-color fallback text color, e.g. for a light custom background. */
  foregroundColor?: string;
  fallbackText: string;
  colorKey?: string | null;
  size?: number;
  radius?: number;
}) {
  const resolvedRadius = radius ?? Math.round(size * 0.32);
  const background = color || (colorKey ? circleColorFromKey(colorKey).background : DEFAULT_BG);
  const foreground =
    foregroundColor ?? (color ? '#FFFFFF' : colorKey ? circleColorFromKey(colorKey).foreground : '#FFFFFF');

  return (
    <View
      className="items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: resolvedRadius,
        backgroundColor: background,
      }}
    >
      {emoji ? (
        <Text style={{ fontSize: Math.round(size * 0.5) }}>{emoji}</Text>
      ) : (
        <Text
          style={{ fontSize: Math.round(size * 0.4), fontWeight: '900', color: foreground }}
        >
          {fallbackText.slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}
