/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

// Cahootz: white community spaces, quiet surfaces, clear actions.
// Shared by native styles; global.css mirrors the semantic colors for NativeWind.
export const CommunityTheme = {
  paper: '#FFFFFF',
  sheet: '#FFFFFF',
  primary: '#B94614',
  primarySoft: '#FFFFFF',
  primaryBorder: '#E5E7EB',
  ink: '#111827',
  muted: '#64748B',
  border: '#E5E7EB',
  pageMaxWidth: 800,
} as const;

const tintColorLight = CommunityTheme.primary;
const tintColorDark = '#FF8A2A';

export const Colors = {
  light: {
    text: '#0F172A',
    background: '#fff',
    tint: tintColorLight,
    icon: '#64748B',
    tabIconDefault: '#64748B',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#94A3B8',
    tabIconDefault: '#94A3B8',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
