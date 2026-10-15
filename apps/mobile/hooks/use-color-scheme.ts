/**
 * Cahootz currently ships one supported application theme.
 *
 * Keep navigation and components on the light palette even when the device is
 * set to dark mode. Most screens intentionally use light, brand-specific
 * surfaces, so allowing a partial automatic dark theme can produce unreadable
 * combinations such as white controls on white cards.
 */
export function useColorScheme(): 'light' | 'dark' {
  return 'light';
}
