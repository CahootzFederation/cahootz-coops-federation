import React, { useState } from 'react';
import { Image, View, type ViewStyle } from 'react-native';
import { ShoppingBasket } from 'lucide-react-native';

const colors = { goldSoft: '#FFF1D6', orange: '#E85D04' };

/**
 * A group buy's photo, or a stand-in when it has none or the photo won't load,
 * so every card has a picture.
 */
export function OfferImage({ uri, height, width, radius = 12 }: { uri?: string | null; height: number; width?: number; radius?: number }) {
  const [failed, setFailed] = useState(false);
  const box: ViewStyle = { height, width: width ?? '100%', borderRadius: radius, overflow: 'hidden' };
  if (uri && !failed) {
    return (
      <View style={box}>
        <Image source={{ uri }} onError={() => setFailed(true)} resizeMode="cover" style={{ width: '100%', height: '100%' }} accessibilityIgnoresInvertColors />
      </View>
    );
  }
  return (
    <View testID="offer-image-placeholder" style={[box, { backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' }]}>
      <ShoppingBasket size={Math.min(40, Math.round(height * 0.4))} color={colors.orange} />
    </View>
  );
}
