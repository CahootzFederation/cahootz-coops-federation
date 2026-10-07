import { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { SmilePlus } from 'lucide-react-native';

import { EmojiPickerSheet } from '@/components/emoji-picker';
import { Text } from '@/components/ui/text';
import type { ReactionSummary } from '@/lib/api';
import { LIKE_EMOJI, emojiName } from '@/lib/emoji-catalog';

const PRIMARY = '#FF6B00';

/**
 * Slack-style emoji reactions: one chip per emoji (tap to add or remove
 * yours) and a button that opens the full emoji picker. The like (❤️) keeps
 * its own button, so its chip is hidden here.
 */
export function ReactionBar({
  reactions,
  onToggle,
  disabled = false,
  targetLabel,
  children,
}: {
  reactions: readonly ReactionSummary[];
  onToggle: (emoji: string) => void;
  disabled?: boolean;
  /** e.g. "Ana's comment", for screen reader labels. */
  targetLabel: string;
  /** Rendered first in the row, e.g. the like button. */
  children?: React.ReactNode;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const chips = reactions.filter((reaction) => reaction.emoji !== LIKE_EMOJI && reaction.count > 0);
  const mine = reactions.filter((reaction) => reaction.viewerReacted).map((reaction) => reaction.emoji);

  return (
    <View className="flex-row flex-wrap items-center gap-1.5">
      {children}
      {chips.map((reaction) => (
        <TouchableOpacity
          key={reaction.emoji}
          onPress={() => onToggle(reaction.emoji)}
          disabled={disabled}
          className="flex-row items-center gap-1 rounded-full border px-2 py-0.5"
          style={{
            borderColor: reaction.viewerReacted ? PRIMARY : '#E7E5E4',
            backgroundColor: reaction.viewerReacted ? '#FFF7ED' : '#FFFFFF',
            opacity: disabled ? 0.5 : 1,
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: reaction.viewerReacted }}
          accessibilityLabel={`${reaction.viewerReacted ? 'Remove your' : 'Add'} ${emojiName(reaction.emoji)} reaction ${reaction.viewerReacted ? 'from' : 'to'} ${targetLabel}, ${reaction.count} ${reaction.count === 1 ? 'reaction' : 'reactions'}`}
        >
          <Text style={{ fontSize: 14, lineHeight: 19 }}>{reaction.emoji}</Text>
          <Text
            className="text-[11px] font-bold"
            style={{ color: reaction.viewerReacted ? PRIMARY : '#78716C' }}
          >
            {reaction.count}
          </Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        onPress={() => setPickerOpen(true)}
        disabled={disabled}
        className="h-6 w-8 items-center justify-center rounded-full"
        style={{ opacity: disabled ? 0.5 : 1 }}
        accessibilityRole="button"
        accessibilityLabel={`Add a reaction to ${targetLabel}`}
      >
        <SmilePlus size={15} color="#78716C" />
      </TouchableOpacity>
      <EmojiPickerSheet
        visible={pickerOpen}
        title="Add a reaction"
        onClose={() => setPickerOpen(false)}
        onSelect={onToggle}
        selected={mine}
        showQuickReactions
      />
    </View>
  );
}
