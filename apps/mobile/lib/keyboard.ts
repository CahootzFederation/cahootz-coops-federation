import { Platform } from 'react-native';

/**
 * Shared keyboard behavior for every screen where a member types.
 *
 * - `keyboardShouldPersistTaps: 'handled'` lets a tap on Send/Save/Post work on
 *   the first press while the keyboard is open, and a tap on empty space still
 *   puts the keyboard away.
 * - `keyboardDismissMode` lets a downward drag put the keyboard away, which is
 *   the only way out of a multiline field (Return adds a new line there).
 */
export const keyboardScrollProps = {
  keyboardShouldPersistTaps: 'handled',
  keyboardDismissMode: Platform.OS === 'ios' ? 'interactive' : 'on-drag',
} as const;

/** Lift content above the keyboard on iOS; Android resizes the window itself. */
export const keyboardAvoidingBehavior = Platform.OS === 'ios' ? ('padding' as const) : undefined;

/**
 * For a scroll view that is not inside a KeyboardAvoidingView: on iOS the
 * scroll view itself shrinks its content area by the keyboard height and keeps
 * the focused field in view, so the fields and buttons below stay reachable.
 */
export const keyboardInsetScrollProps = {
  ...keyboardScrollProps,
  automaticallyAdjustKeyboardInsets: true,
} as const;
