import type { ReactNode } from 'react';
import { TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';

import { openPersonPage } from '@/lib/person-navigation';

/** Makes a person's name or avatar open their personal page. */
export function PersonLink({
  name,
  handle,
  children,
  className,
  style,
}: {
  name: string;
  handle?: string | null;
  children: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      onPress={() => openPersonPage(name, handle)}
      className={className}
      style={style}
      activeOpacity={0.72}
      accessibilityRole="link"
      accessibilityLabel={`Open ${name}'s personal page`}
    >
      {children}
    </TouchableOpacity>
  );
}
