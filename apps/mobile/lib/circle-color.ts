// Maps the server-computed `colorKey` (see packages/trpc/src/lib/circle-color.ts)
// to an accessible background/foreground pair from the app's warm palette, so
// every circle card gets a stable color without the client hashing anything itself.
export type CircleColorPalette = {
  background: string;
  border: string;
  foreground: string;
};

const CIRCLE_COLOR_PALETTES: Record<string, CircleColorPalette> = {
  gold: { background: '#FFF7ED', border: '#FED7AA', foreground: '#C2410C' },
  purple: { background: '#F5F3FF', border: '#DDD6FE', foreground: '#6D28D9' },
  orange: { background: '#FFF1E6', border: '#FDBA95', foreground: '#C2410C' },
  green: { background: '#F0FDF4', border: '#BBF7D0', foreground: '#15803D' },
  blue: { background: '#EFF6FF', border: '#BFDBFE', foreground: '#1D4ED8' },
  rose: { background: '#FFF1F2', border: '#FECDD3', foreground: '#BE123C' },
};

const DEFAULT_PALETTE: CircleColorPalette = CIRCLE_COLOR_PALETTES.gold;

export function circleColorFromKey(colorKey: string | undefined | null): CircleColorPalette {
  if (!colorKey) return DEFAULT_PALETTE;
  return CIRCLE_COLOR_PALETTES[colorKey] || DEFAULT_PALETTE;
}
