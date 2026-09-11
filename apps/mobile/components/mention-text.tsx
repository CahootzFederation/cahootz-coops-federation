import React, { useMemo } from 'react';
import { View, type TextStyle, type ViewStyle } from 'react-native';
import MarkdownIt from 'markdown-it';
import Markdown, { type ASTNode, type RenderRules } from 'react-native-markdown-display';
import { Text } from '@/components/ui/text';

const MENTION_RE = /\[@([a-zA-Z0-9_-]+)\]/g;

/**
 * markdown-it doesn't know about our `[@handle]` mention syntax - by default
 * it would treat `[...]` as the start of a link/image reference. This
 * inline rule intercepts it first and emits a dedicated `mention` token
 * instead, which the `mention` entry in RenderRules below turns into a
 * styled, pressable `@handle`.
 */
function mentionPlugin(md: MarkdownIt) {
  md.inline.ruler.before('link', 'mention', (state, silent) => {
    MENTION_RE.lastIndex = 0;
    const match = MENTION_RE.exec(state.src.slice(state.pos));
    if (!match || match.index !== 0) return false;
    if (!silent) {
      const token = state.push('mention', '', 0);
      token.content = match[1];
    }
    state.pos += match[0].length;
    return true;
  });
}

const markdownItInstance = new MarkdownIt({ typographer: false, linkify: false }).use(mentionPlugin);

type FlatPart = string | { key: string; handle: string };

function flattenMentions(content: string): FlatPart[] {
  const parts: FlatPart[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of content.matchAll(MENTION_RE)) {
    const [full, handle] = match;
    const start = match.index ?? 0;
    if (start > lastIndex) parts.push(content.slice(lastIndex, start));
    parts.push({ key: `mention-${key++}`, handle });
    lastIndex = start + full.length;
  }
  if (lastIndex < content.length) parts.push(content.slice(lastIndex));
  return parts;
}

interface MentionTextProps {
  content: string;
  /** Applied to the outer wrapper - use for margin/layout only (e.g. "mt-3"). */
  className?: string;
  /** Base text typography (color/size/lineHeight/weight) for the rendered markdown. */
  style?: TextStyle;
  /**
   * Caps the text to N lines. Renders a flattened, plain (non-markdown)
   * version instead - RN's numberOfLines truncation doesn't work across a
   * nested rich-text tree, and a snippet preview doesn't need formatting.
   */
  numberOfLines?: number;
  onPressMention?: (handle: string) => void;
  mentionClassName?: string;
}

const DEFAULT_MENTION_CLASS = 'font-bold text-red-700';

/**
 * Renders post/comment/DM body text (and titles) with:
 * - Markdown formatting (bold, italic, lists, etc.) - Sage's replies come
 *   back from the LLM as markdown, and plain posts/comments are just text
 *   with no markdown syntax in them, so this is safe for both.
 * - `[@handle]` mention tokens (the canonical form the backend stores for
 *   confirmed @-mentions) styled as an inline highlighted, pressable `@handle`.
 */
export function MentionText({
  content,
  className,
  style,
  numberOfLines,
  onPressMention,
  mentionClassName,
}: MentionTextProps) {
  const rules: RenderRules = useMemo(
    () => ({
      mention: (node: ASTNode) => (
        <Text
          key={node.key}
          className={mentionClassName ?? DEFAULT_MENTION_CLASS}
          onPress={onPressMention ? () => onPressMention(node.content) : undefined}
        >
          @{node.content}
        </Text>
      ),
    }),
    [mentionClassName, onPressMention],
  );

  const markdownStyle = useMemo(() => buildMarkdownStyle(style), [style]);

  if (numberOfLines != null) {
    const parts = flattenMentions(content).map((part) =>
      typeof part === 'string' ? (
        part
      ) : (
        <Text
          key={part.key}
          className={mentionClassName ?? DEFAULT_MENTION_CLASS}
          onPress={onPressMention ? () => onPressMention(part.handle) : undefined}
        >
          @{part.handle}
        </Text>
      ),
    );
    return (
      <Text className={className} style={style} numberOfLines={numberOfLines}>
        {parts}
      </Text>
    );
  }

  return (
    <View className={className}>
      <Markdown markdownit={markdownItInstance} rules={rules} style={markdownStyle}>
        {content}
      </Markdown>
    </View>
  );
}

function buildMarkdownStyle(textStyle?: TextStyle): Record<string, TextStyle | ViewStyle> {
  const base: TextStyle = { color: '#1F2937', fontSize: 14, lineHeight: 20, ...textStyle };

  return {
    // `body`/`paragraph` render as plain <View>s in this library - text-only
    // props like color/fontSize get stripped from them. The actual text runs
    // come through `text`/`textgroup` (both <Text>), so the base typography
    // has to live there instead for it to actually take effect.
    text: base,
    textgroup: base,
    paragraph: { marginTop: 0, marginBottom: 6 },
    strong: { fontWeight: '800' },
    em: { fontStyle: 'italic' },
    bullet_list: { marginBottom: 4 },
    ordered_list: { marginBottom: 4 },
    list_item: { marginBottom: 2, flexDirection: 'row' },
    link: { color: base.color, textDecorationLine: 'underline' },
    code_inline: {
      backgroundColor: '#F3F4F6',
      fontFamily: 'Courier',
      paddingHorizontal: 4,
      borderRadius: 4,
      fontSize: base.fontSize,
    },
    fence: {
      backgroundColor: '#F3F4F6',
      fontFamily: 'Courier',
      padding: 8,
      borderRadius: 8,
    },
  };
}
