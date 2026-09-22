import { useState } from 'react';
import { Modal, ScrollView, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { CheckCircle2, X } from 'lucide-react-native';
import { IconAvatar } from '@/components/icon-avatar';

const EMOJI_OPTIONS = [
  '🏠', '🤝', '🌱', '🎨', '📚', '💡', '🛠️', '💰',
  '🍲', '🎉', '📣', '🗳️', '🧭', '🌟', '🔥', '🌍',
  '🏗️', '🧑‍🤝‍🧑', '🛒', '🎯', '🚀', '🌻', '☕', '🎵',
];

const COLOR_OPTIONS = [
  '#FF6B00', '#C2410C', '#B45309', '#15803D',
  '#1D4ED8', '#6D28D9', '#BE123C', '#0F766E',
];

export function EmojiColorPicker({
  visible,
  title,
  fallbackText,
  initialEmoji,
  initialColor,
  onClose,
  onSave,
}: {
  visible: boolean;
  title: string;
  fallbackText: string;
  initialEmoji?: string | null;
  initialColor?: string | null;
  onClose: () => void;
  onSave: (emoji: string | null, color: string | null) => void;
}) {
  const [emoji, setEmoji] = useState<string | null>(initialEmoji ?? null);
  const [color, setColor] = useState<string | null>(initialColor ?? COLOR_OPTIONS[0]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl bg-white px-4 pb-8 pt-5" style={{ maxHeight: '85%' }}>
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-xl font-black text-gray-950">{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              className="h-9 w-9 items-center justify-center rounded-full bg-gray-100"
              accessibilityLabel="Close"
            >
              <X size={18} color="#374151" />
            </TouchableOpacity>
          </View>

          <View className="mb-5 items-center">
            <IconAvatar
              emoji={emoji}
              color={color}
              fallbackText={fallbackText}
              size={72}
            />
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text className="mb-2 text-xs font-black uppercase text-gray-500">
              Emoji
            </Text>
            <View className="mb-5 flex-row flex-wrap gap-2">
              {emoji ? (
                <TouchableOpacity
                  onPress={() => setEmoji(null)}
                  className="h-12 w-12 items-center justify-center rounded-xl border border-dashed border-gray-300"
                  accessibilityLabel="Clear emoji, use initial instead"
                >
                  <Text className="text-xs font-bold text-gray-500">None</Text>
                </TouchableOpacity>
              ) : null}
              {EMOJI_OPTIONS.map((option) => {
                const selected = emoji === option;
                return (
                  <TouchableOpacity
                    key={option}
                    onPress={() => setEmoji(option)}
                    className="h-12 w-12 items-center justify-center rounded-xl border"
                    style={{
                      borderColor: selected ? '#FF6B00' : '#E5E7EB',
                      backgroundColor: selected ? '#FFF7ED' : '#FFFFFF',
                    }}
                  >
                    <Text style={{ fontSize: 22 }}>{option}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text className="mb-2 text-xs font-black uppercase text-gray-500">
              Color
            </Text>
            <View className="mb-5 flex-row flex-wrap gap-3">
              {COLOR_OPTIONS.map((option) => {
                const selected = color === option;
                return (
                  <TouchableOpacity
                    key={option}
                    onPress={() => setColor(option)}
                    className="h-11 w-11 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: option,
                      borderWidth: selected ? 3 : 0,
                      borderColor: '#111827',
                    }}
                    accessibilityLabel={`Use color ${option}`}
                  >
                    {selected ? <CheckCircle2 size={18} color="#FFFFFF" /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <TouchableOpacity
            onPress={() => {
              onSave(emoji, color);
              onClose();
            }}
            className="mt-2 rounded-xl px-4 py-3"
            style={{ backgroundColor: '#FF6B00' }}
          >
            <Text className="text-center font-black text-white">Save icon</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
