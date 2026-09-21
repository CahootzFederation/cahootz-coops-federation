// Deterministic circle-id -> palette-bucket mapping, computed server-side so
// every client renders the same color for the same circle without each
// needing its own hash implementation.
export const CIRCLE_COLOR_KEYS = [
  "gold",
  "purple",
  "orange",
  "green",
  "blue",
  "rose",
] as const;

export type CircleColorKey = (typeof CIRCLE_COLOR_KEYS)[number];

export function hashToColorKey(id: string): CircleColorKey {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % CIRCLE_COLOR_KEYS.length;
  return CIRCLE_COLOR_KEYS[index];
}
