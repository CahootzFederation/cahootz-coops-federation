import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
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
  label: string;
  caption?: string;
}

const SAGE_SUGGESTION: Suggestion = { id: 'sage', name: 'sage', label: 'Sage', caption: 'Commons AI assistant' };

function personInitial(label: string) {
  return label.trim().slice(0, 1).toUpperCase() || '?';
}

/**
 * Dropdown shown while composing a post/comment/DM whenever the cursor is
 * mid-@mention (keyword !== undefined, see react-native-controlled-mentions).
 * Empty keyword shows recently-active Commons members; a non-empty keyword
 * debounce-searches by name/handle. Sage is always pinned when it matches.
 */
export function MentionSuggestions({ keyword, onSelect, coopId = 'cahootz' }: MentionSuggestionsProps) {
  const { sessionToken } = useAuth();
  const [defaultMembers, setDefaultMembers] = useState<Suggestion[]>([]);
  const [searchResults, setSearchResults] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (keyword == null || defaultMembers.length > 0) return;
    api
      .listDirectMembers(sessionToken)
      .then((result) => {
        setDefaultMembers(
          result.members
            .filter((m) => m.handle)
            .map((m) => ({ id: m.id, name: m.handle, label: m.name, caption: `@${m.handle}` })),
        );
      })
      .catch(() => setDefaultMembers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword == null, sessionToken]);

  useEffect(() => {
    const trimmed = (keyword ?? '').trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }

    const thisRequest = ++requestId.current;
    setIsLoading(true);
    const timeout = setTimeout(() => {
      api
        .searchCommons({ coopId, query: trimmed, limit: 8 }, sessionToken)
        .then((result) => {
          if (requestId.current !== thisRequest) return;
          setSearchResults(
            result.people.map((p) => ({ id: p.id, name: p.handle, label: p.name, caption: `@${p.handle}` })),
          );
        })
        .catch(() => {
          if (requestId.current === thisRequest) setSearchResults([]);
        })
        .finally(() => {
          if (requestId.current === thisRequest) setIsLoading(false);
        });
    }, 250);

    return () => clearTimeout(timeout);
  }, [keyword, coopId, sessionToken]);

  if (keyword == null) return null;

  const trimmedKeyword = keyword.trim().toLowerCase();
  const base = trimmedKeyword ? searchResults : defaultMembers;
  const sageMatches = !trimmedKeyword || 'sage'.startsWith(trimmedKeyword);
  const results: Suggestion[] = [
    ...(sageMatches ? [SAGE_SUGGESTION] : []),
    ...base.filter((s) => s.name !== 'sage'),
  ].slice(0, 8);

  if (results.length === 0 && !isLoading) return null;

  return (
    <View
      className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg"
      style={{ maxHeight: 220, elevation: 12, zIndex: 50 }}
    >
      <ScrollView keyboardShouldPersistTaps="always" bounces={false}>
        {results.map((suggestion, index) => (
          <Pressable
            key={suggestion.id}
            // onPressIn (not onPress) - fires on touch-down, before the tap can blur the
            // still-focused composer TextInput. onPress fires on release, by which point
            // the blur has already torn down the mention/selection state this depends on,
            // so the row visually presses but nothing gets inserted.
            onPressIn={() => onSelect({ id: suggestion.name, name: suggestion.name })}
            className={`flex-row items-center gap-3 px-3 py-2.5 ${
              index < results.length - 1 ? 'border-b border-gray-100' : ''
            }`}
          >
            <View className="h-8 w-8 items-center justify-center rounded-full bg-slate-200">
              <Text className="text-xs font-black text-slate-600">{personInitial(suggestion.label)}</Text>
            </View>
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
