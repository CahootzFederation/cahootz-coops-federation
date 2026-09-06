import { Modal, ScrollView, TouchableOpacity, View } from 'react-native';
import { useState } from 'react';
import { Tag, X } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { INTENT_POST_TYPES, postTypeLabel, type SelectedPostType } from '@/lib/post-types';

type PostTypeSelectorProps = {
  value: SelectedPostType;
  onChange: (value: SelectedPostType) => void;
};

export function PostTypeSelector({ value, onChange }: PostTypeSelectorProps) {
  const [open, setOpen] = useState(false);

  const select = (nextValue: SelectedPostType) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        className="h-8 w-8 items-center justify-center rounded-full border"
        style={{
          backgroundColor: value ? '#FFF7ED' : '#FFFFFF',
          borderColor: value ? '#FF6B00' : '#E5E7EB',
        }}
        activeOpacity={0.78}
        accessibilityLabel={value ? `Post type: ${postTypeLabel(value)}` : 'Choose post type'}
      >
        <Tag size={15} color={value ? '#FF6B00' : '#475569'} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end bg-black/35">
          <View className="max-h-[70%] rounded-t-2xl bg-white">
            <View className="flex-row items-center justify-between border-b border-gray-200 px-5 pb-4 pt-5">
              <View>
                <Text className="text-xs font-black uppercase text-gray-500">Post type</Text>
                <Text className="text-xl font-black text-gray-950">Optional label</Text>
              </View>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                className="h-10 w-10 items-center justify-center rounded-xl bg-gray-100"
                accessibilityLabel="Close post type picker"
              >
                <X size={20} color="#111827" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 26 }}>
              <View className="gap-2">
                <TouchableOpacity
                  onPress={() => select(null)}
                  className="flex-row items-center justify-between rounded-xl border p-3"
                  style={{
                    backgroundColor: value === null ? '#FFF7ED' : '#FFFFFF',
                    borderColor: value === null ? '#FF6B00' : '#E5E7EB',
                  }}
                  activeOpacity={0.78}
                >
                  <Text className="text-sm font-black text-gray-950">No type</Text>
                  {value === null ? <Text className="text-xs font-black text-orange-600">Default</Text> : null}
                </TouchableOpacity>
                {INTENT_POST_TYPES.map((type) => {
                  const selected = type.value === value;
                  return (
                    <TouchableOpacity
                      key={type.value}
                      onPress={() => select(type.value)}
                      className="flex-row items-center justify-between rounded-xl border p-3"
                      style={{
                        backgroundColor: selected ? '#FFF7ED' : '#FFFFFF',
                        borderColor: selected ? '#FF6B00' : '#E5E7EB',
                      }}
                      activeOpacity={0.78}
                    >
                      <Text className="text-sm font-black text-gray-950">{type.label}</Text>
                      {selected ? <Text className="text-xs font-black text-orange-600">Selected</Text> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
