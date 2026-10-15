import { Image as ExpoImage } from 'expo-image';

// Source artwork is assets/images/sage/sage.svg; the PNG is that SVG rendered
// at 512px with a transparent background.
const SAGE_AVATAR_IMAGE = require('@/assets/images/sage/sage.png');

/**
 * Sage's face: a soft peach blob with round glasses. Use it anywhere Sage
 * would otherwise get initials or a sparkle icon. It is the same in every
 * Commons.
 */
export function SageAvatar({ size = 40 }: { size?: number }) {
  return (
    <ExpoImage
      source={SAGE_AVATAR_IMAGE}
      style={{ width: size, height: size }}
      contentFit="contain"
      accessibilityLabel="Sage, the AI helper"
      testID="sage-avatar"
    />
  );
}
