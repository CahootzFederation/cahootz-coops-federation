import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  TextInput,
  TouchableOpacity,
  View,
  type ViewToken,
} from 'react-native';
import { Clock, Search, X } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import {
  EMOJI_CATEGORIES,
  QUICK_REACTIONS,
  emojiName,
  loadRecentEmoji,
  rememberEmoji,
  searchEmoji,
} from '@/lib/emoji-catalog';

const PRIMARY = '#FF6B00';
const CELL = 44;
const HEADER_HEIGHT = 30;

type Row =
  | { kind: 'header'; key: string; sectionId: string; label: string }
  | { kind: 'row'; key: string; sectionId: string; emojis: string[] };

interface Section {
  id: string;
  label: string;
  emojis: string[];
}

function buildRows(sections: Section[], columns: number): Row[] {
  const rows: Row[] = [];
  for (const section of sections) {
    if (section.emojis.length === 0) continue;
    rows.push({ kind: 'header', key: `h-${section.id}`, sectionId: section.id, label: section.label });
    for (let i = 0; i < section.emojis.length; i += columns) {
      rows.push({
        kind: 'row',
        key: `${section.id}-${i}`,
        sectionId: section.id,
        emojis: section.emojis.slice(i, i + columns),
      });
    }
  }
  return rows;
}

const rowHeight = (row: Row) => (row.kind === 'header' ? HEADER_HEIGHT : CELL);

/**
 * A full emoji picker, like Slack's or Notion's: search, recently used, and
 * every emoji by category. Shown as a bottom sheet.
 */
export function EmojiPickerSheet({
  visible,
  title = 'Choose an emoji',
  onClose,
  onSelect,
  selected = [],
  showQuickReactions = false,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  /** Called with the picked emoji. The sheet closes itself afterwards. */
  onSelect: (emoji: string) => void;
  /** Emoji to highlight, e.g. the viewer's current reactions or icon. */
  selected?: readonly string[];
  /** Show the one-tap reaction row above the full picker. */
  showQuickReactions?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const [width, setWidth] = useState(0);
  const [activeSection, setActiveSection] = useState<string>('');
  const listRef = useRef<FlatList<Row>>(null);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    let mounted = true;
    void loadRecentEmoji().then((items) => {
      if (mounted) setRecents(items);
    });
    return () => {
      mounted = false;
    };
  }, [visible]);

  const columns = Math.max(6, Math.floor(width / CELL) || 8);
  const searching = query.trim().length > 0;

  const sections = useMemo<Section[]>(() => {
    if (searching) {
      return [{ id: 'results', label: 'Results', emojis: searchEmoji(query).map(([emoji]) => emoji) }];
    }
    return [
      { id: 'recent', label: 'Recently used', emojis: recents },
      ...EMOJI_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        emojis: category.emojis.map(([emoji]) => emoji),
      })),
    ];
  }, [query, recents, searching]);

  const rows = useMemo(() => buildRows(sections, columns), [sections, columns]);
  const offsets = useMemo(() => {
    const result: number[] = [];
    let y = 0;
    for (const row of rows) {
      result.push(y);
      y += rowHeight(row);
    }
    return result;
  }, [rows]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const pick = useCallback(
    (emoji: string) => {
      void rememberEmoji(emoji).then(setRecents);
      onSelect(emoji);
      onClose();
    },
    [onClose, onSelect],
  );

  const jumpTo = (sectionId: string) => {
    const index = rows.findIndex((row) => row.kind === 'header' && row.sectionId === sectionId);
    if (index < 0) return;
    setActiveSection(sectionId);
    listRef.current?.scrollToOffset({ offset: offsets[index] ?? 0, animated: false });
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((token) => token.isViewable)?.item as Row | undefined;
    if (first) setActiveSection(first.sectionId);
  }).current;

  const tabs = [
    ...(recents.length ? [{ id: 'recent', label: 'Recently used', icon: null as string | null }] : []),
    ...EMOJI_CATEGORIES.map((category) => ({ id: category.id, label: category.label, icon: category.icon })),
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={onClose} accessibilityLabel="Close emoji picker" />
        <View
          className="rounded-t-3xl bg-white px-4 pb-6 pt-4"
          style={{ height: '78%' }}
          accessibilityViewIsModal
          accessibilityLabel={title}
          testID="emoji-picker"
        >
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-black text-gray-950">{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              className="h-9 w-9 items-center justify-center rounded-full bg-gray-100"
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={18} color="#374151" />
            </TouchableOpacity>
          </View>

          {showQuickReactions ? (
            <View className="mb-3 flex-row justify-between">
              {QUICK_REACTIONS.map((emoji) => (
                <EmojiCell
                  key={emoji}
                  emoji={emoji}
                  selected={selectedSet.has(emoji)}
                  onPress={pick}
                  size={40}
                />
              ))}
            </View>
          ) : null}

          <View className="mb-2 flex-row items-center gap-2 rounded-xl bg-gray-100 px-3">
            <Search size={16} color="#6B7280" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search all emoji"
              placeholderTextColor="#9CA3AF"
              accessibilityLabel="Search emoji"
              autoCorrect={false}
              autoCapitalize="none"
              className="flex-1 py-2.5 text-sm text-gray-900"
              style={{ outlineStyle: 'none' } as never}
            />
            {searching ? (
              <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Clear search">
                <X size={16} color="#6B7280" />
              </TouchableOpacity>
            ) : null}
          </View>

          {!searching ? (
            <View className="mb-1 flex-row justify-between border-b border-gray-100 pb-1">
              {tabs.map((tab) => {
                const active = activeSection === tab.id;
                return (
                  <TouchableOpacity
                    key={tab.id}
                    onPress={() => jumpTo(tab.id)}
                    className="h-8 w-8 items-center justify-center rounded-lg"
                    style={{ backgroundColor: active ? '#FFF7ED' : 'transparent' }}
                    accessibilityRole="tab"
                    accessibilityLabel={tab.label}
                    accessibilityState={{ selected: active }}
                    aria-selected={active}
                  >
                    {tab.icon ? (
                      <Text style={{ fontSize: 17, lineHeight: 22, opacity: active ? 1 : 0.55 }}>{tab.icon}</Text>
                    ) : (
                      <Clock size={16} color={active ? PRIMARY : '#9CA3AF'} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          <View className="flex-1" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
            {searching && rows.length === 0 ? (
              <Text className="mt-6 text-center text-sm text-gray-500">No emoji match “{query.trim()}”.</Text>
            ) : (
              <FlatList
                ref={listRef}
                testID="emoji-picker-grid"
                data={rows}
                keyExtractor={(row) => row.key}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={14}
                maxToRenderPerBatch={12}
                windowSize={7}
                getItemLayout={(_, index) => ({
                  length: rows[index] ? rowHeight(rows[index]) : CELL,
                  offset: offsets[index] ?? 0,
                  index,
                })}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
                renderItem={({ item }) =>
                  item.kind === 'header' ? (
                    <View style={{ height: HEADER_HEIGHT, justifyContent: 'flex-end', paddingBottom: 4 }}>
                      <Text className="text-xs font-black uppercase text-gray-500">{item.label}</Text>
                    </View>
                  ) : (
                    <View className="flex-row" style={{ height: CELL }}>
                      {item.emojis.map((emoji) => (
                        <EmojiCell
                          key={emoji}
                          emoji={emoji}
                          selected={selectedSet.has(emoji)}
                          onPress={pick}
                          size={Math.floor(width / columns) || CELL}
                        />
                      ))}
                    </View>
                  )
                }
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function EmojiCell({
  emoji,
  selected,
  onPress,
  size,
}: {
  emoji: string;
  selected: boolean;
  onPress: (emoji: string) => void;
  size: number;
}) {
  return (
    <TouchableOpacity
      onPress={() => onPress(emoji)}
      className="items-center justify-center rounded-lg"
      style={{ width: size, height: CELL, backgroundColor: selected ? '#FFF7ED' : 'transparent' }}
      accessibilityRole="button"
      accessibilityLabel={emojiName(emoji)}
      accessibilityState={{ selected }}
    >
      <Text style={{ fontSize: 26, lineHeight: 34 }}>{emoji}</Text>
    </TouchableOpacity>
  );
}

/**
 * A short grid of suggested emoji plus a "More" tile that opens the full
 * picker. An emoji picked from the full picker joins the grid, selected.
 */
export function EmojiChoiceGrid({
  options,
  value,
  onChange,
  tileSize = 48,
  pickerTitle = 'Choose an emoji',
  labelFor = (emoji: string) => `Use emoji ${emoji}`,
  leading,
}: {
  options: readonly string[];
  value: string | null;
  onChange: (emoji: string) => void;
  tileSize?: number;
  pickerTitle?: string;
  labelFor?: (emoji: string) => string;
  /** Rendered before the tiles, e.g. a "None" tile. */
  leading?: React.ReactNode;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const tiles = value && !options.includes(value) ? [value, ...options] : options;

  return (
    <View className="flex-row flex-wrap gap-2">
      {leading}
      {tiles.map((option) => {
        const selected = value === option;
        return (
          <TouchableOpacity
            key={option}
            onPress={() => onChange(option)}
            className="items-center justify-center rounded-xl border"
            style={{
              width: tileSize,
              height: tileSize,
              borderColor: selected ? PRIMARY : '#E5E7EB',
              backgroundColor: selected ? '#FFF7ED' : '#FFFFFF',
            }}
            accessibilityRole="button"
            accessibilityLabel={labelFor(option)}
            accessibilityState={{ selected }}
            aria-selected={selected}
          >
            <Text style={{ fontSize: Math.round(tileSize * 0.46), lineHeight: Math.round(tileSize * 0.6) }}>
              {option}
            </Text>
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity
        onPress={() => setPickerOpen(true)}
        className="items-center justify-center rounded-xl border border-dashed border-gray-300"
        style={{ width: tileSize, height: tileSize }}
        accessibilityRole="button"
        accessibilityLabel="More emoji"
      >
        <Text className="text-[11px] font-bold text-gray-500">More</Text>
      </TouchableOpacity>
      <EmojiPickerSheet
        visible={pickerOpen}
        title={pickerTitle}
        onClose={() => setPickerOpen(false)}
        onSelect={onChange}
        selected={value ? [value] : []}
      />
    </View>
  );
}
