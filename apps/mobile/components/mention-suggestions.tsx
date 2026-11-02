import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SageAvatar } from '@/components/sage-avatar';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

interface MentionSuggestionsProps {
  keyword: string | undefined;
  onSelect: (suggestion: { id: string; name: string }) => void;
  coopId?: string;
}

interface Suggestion {
  id: string;
  name: string;
  canonicalHandle: string;
  label: string;
  caption?: string;
  /** Sage's own account, shown with Sage's face. */
  isSage?: boolean;
}

function personInitial(label: string) {
  return label.trim().slice(0, 1).toUpperCase() || '?';
}

/**
 * Dropdown shown while composing a post/comment/DM whenever the cursor is
 * mid-@mention (keyword !== undefined, see react-native-controlled-mentions).
 * Empty keyword shows recently-active Commons members; a non-empty keyword
 * debounce-searches by name/handle. Every result has an active membership in
 * this Commons, and this Commons' own Sage account is pinned when it matches.
 */
export function MentionSuggestions({ keyword, onSelect, coopId = 'cahootz' }: MentionSuggestionsProps) {
  const { sessionToken } = useAuth();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestId = useRef(0);
  // The selection captured at touch-down, committed on release. See the row's handlers.
  const pendingSelect = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (keyword == null) {
      requestId.current += 1;
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const trimmed = (keyword ?? '').trim();
    const thisRequest = ++requestId.current;
    setIsLoading(true);
    setSuggestions([]);
    const timeout = setTimeout(() => {
      api
        .listMentionMembers({ coopId, query: trimmed, limit: 8 }, sessionToken)
        .then((result) => {
          if (requestId.current !== thisRequest) return;
          setSuggestions(
            result.members.map((member) => ({
              canonicalHandle: member.handle,
              id: member.id,
              name: member.isSage ? 'sage' : member.handle,
              label: member.name,
              caption: member.isSage ? 'Commons AI assistant' : `@${member.handle}`,
              isSage: member.isSage,
            })),
          );
        })
        .catch(() => {
          if (requestId.current === thisRequest) setSuggestions([]);
        })
        .finally(() => {
          if (requestId.current === thisRequest) setIsLoading(false);
        });
    }, trimmed ? 250 : 0);

    return () => clearTimeout(timeout);
  }, [keyword, coopId, sessionToken]);

  if (keyword == null) return null;

  const results: Suggestion[] = [
    ...suggestions.filter((suggestion) => suggestion.isSage),
    ...suggestions.filter((suggestion) => !suggestion.isSage),
  ].slice(0, 8);

  if (results.length === 0 && !isLoading) return null;

  return (
    <View
      className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg"
      style={{ maxHeight: 220, elevation: 12, zIndex: 50 }}
      accessibilityLabel="Mention suggestions"
    >
      <ScrollView testID="mention-suggestions" keyboardShouldPersistTaps="always" bounces={false}>
        {results.map((suggestion, index) => (
          <Pressable
            key={suggestion.id}
            testID={`mention-suggestion-${suggestion.canonicalHandle}`}
            // Capture onSelect on touch-down, before the tap can blur the still-focused
            // composer TextInput and tear down the mention/selection state its closure
            // depends on. Only commit it on release: selecting on touch-down meant any
            // swipe that started on a row picked that person instead of scrolling the
            // list. A swipe cancels the press, so onPress never fires and nothing is picked.
            onPressIn={() => {
              pendingSelect.current = () => onSelect({ id: suggestion.name, name: suggestion.name });
            }}
            onPress={() => {
              const select = pendingSelect.current;
              pendingSelect.current = null;
              select?.();
            }}
            className={`flex-row items-center gap-3 px-3 py-2.5 ${
              index < results.length - 1 ? 'border-b border-gray-100' : ''
            }`}
          >
            {suggestion.isSage ? (
              <SageAvatar size={32} />
            ) : (
              <View className="h-8 w-8 items-center justify-center rounded-full bg-slate-200">
                <Text className="text-xs font-black text-slate-600">{personInitial(suggestion.label)}</Text>
              </View>
            )}
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-bold text-gray-900" numberOfLines={1}>
                {suggestion.label}
              </Text>
              {suggestion.caption ? (
                <Text className="text-xs text-gray-500" numberOfLines={1}>
                  {suggestion.caption}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
        {isLoading ? (
          <View className="items-center px-3 py-2.5">
            <ActivityIndicator size="small" color="#9CA3AF" />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
