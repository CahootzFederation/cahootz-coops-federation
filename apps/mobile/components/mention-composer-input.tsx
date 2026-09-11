import { useEffect, useRef, useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { useMentions } from 'react-native-controlled-mentions';
import { MentionSuggestions } from '@/components/mention-suggestions';
import {
  MENTION_TRIGGERS_CONFIG,
  bracketMentionsToMarkup,
  markupToPlainMentions,
  reconcileMentionEdit,
} from '@/lib/mention-markup';

interface MentionComposerInputProps extends Omit<TextInputProps, 'value' | 'onChangeText' | 'children'> {
  value: string;
  onChangeText: (text: string) => void;
  coopId?: string;
}

/**
 * Drop-in replacement for a plain `<TextInput>` composer that adds @-mention
 * autocomplete (tap a suggestion to insert it) and atomic mention deletion
 * (backspacing into a mention removes the whole thing in one step, instead
 * of eating it letter by letter).
 *
 * `value`/`onChangeText` keep the exact same contract callers already use -
 * plain text with `@handle`/`[@handle]` tokens, matching what the backend's
 * encodeMentions() expects and what an existing comment's stored content
 * looks like. Mention-library markup is an internal implementation detail
 * that never leaks to the caller.
 */
export function MentionComposerInput({ value, onChangeText, coopId, ...textInputProps }: MentionComposerInputProps) {
  const lastEmittedRef = useRef<string | null>(null);
  const [rawValue, setRawValue] = useState(() => bracketMentionsToMarkup(value));

  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setRawValue(bracketMentionsToMarkup(value));
    }
  }, [value]);

  const emit = (newRaw: string) => {
    setRawValue(newRaw);
    const plain = markupToPlainMentions(newRaw);
    lastEmittedRef.current = plain;
    onChangeText(plain);
  };

  const { mentionState, triggers, textInputProps: mentionInputProps } = useMentions({
    value: rawValue,
    onChange: emit,
    triggersConfig: MENTION_TRIGGERS_CONFIG,
  });

  const handleChangeText = (newPlainText: string) => {
    const newRaw = reconcileMentionEdit(mentionState.plainText, mentionState.parts, newPlainText);
    emit(newRaw);
  };

  return (
    <View style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <MentionSuggestions keyword={triggers.mention.keyword} onSelect={triggers.mention.onSelect} coopId={coopId} />
      {/*
        Plain controlled `value` (not the library's `children`-based rich-text
        trick, which relies on nested styled <Text> and silently no-ops under
        Fabric/New Architecture - this app has newArchEnabled). The inline
        bold/colored highlight while typing is lost, but insertion, typing,
        and atomic mention deletion all work; `MentionText` still renders the
        highlighted `@handle` once a message is posted.
      */}
      <TextInput
        {...textInputProps}
        value={mentionState.plainText}
        onSelectionChange={mentionInputProps.onSelectionChange}
        onChangeText={handleChangeText}
      />
    </View>
  );
}
