// Hallmark - pre-emit critique: P4 H4 E4 S4 R4 V4
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CheckCheck,
  Lock,
  ArrowLeft,
  Search,
  Send,
  ShieldCheck,
  Plus,
} from 'lucide-react-native';

import { CommunityTheme } from '@/constants/theme';
import { Text } from '@/components/ui/text';
import { MentionText } from '@/components/mention-text';
import { keyboardAvoidingBehavior, keyboardScrollProps } from '@/lib/keyboard';
import {
  api,
  type DirectMember,
  type DirectMessage,
  type DirectPerson,
  type DirectThread,
} from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { SageAvatar } from '@/components/sage-avatar';
import { SageDecisionTrails } from '@/components/sage-decision-trail';
import { LoadError } from '@/components/load-error';
import { friendlyError } from '@/lib/friendly-error';

// Each DM is a private circle shared by exactly two people. A conversation
// entry is either an existing circle (has groupId) or a commons member you
// haven't messaged yet - the circle is created on the first send.
type Conversation = {
  person: DirectPerson;
  groupId: string | null;
  preview: string;
  lastMessageAt: string | null;
  unreadCount: number;
};

const POLL_INTERVAL_MS = 4000;

function threadToConversation(thread: DirectThread): Conversation {
  return {
    person: thread.person,
    groupId: thread.groupId,
    preview: thread.preview
      ? `${thread.lastMessageFromMe ? 'You: ' : ''}${thread.preview}`
      : 'No messages yet',
    lastMessageAt: thread.lastMessageAt,
    unreadCount: thread.unreadCount,
  };
}

function memberToConversation(member: DirectMember): Conversation {
  return {
    person: { id: member.id, name: member.name, handle: member.handle, isSage: member.isSage },
    groupId: null,
    preview: 'Start a private conversation',
    lastMessageAt: null,
    unreadCount: 0,
  };
}

function formatMessageTime(iso: string) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

export default function MessagesScreen() {
  const params = useLocalSearchParams<{ userId?: string; name?: string; groupId?: string }>();
  const { isAuthenticated, sessionToken } = useAuth();
  const insets = useSafeAreaInsets();
  const hasAccountSession = isAuthenticated && !!sessionToken;
  const [threads, setThreads] = useState<DirectThread[]>([]);
  const [members, setMembers] = useState<DirectMember[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [pendingPerson, setPendingPerson] = useState<DirectPerson | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  // Shown as a faded bubble until the send returns. A Sage reply is written
  // inside the send request, so Sage shows as thinking while isSending.
  const [pendingBody, setPendingBody] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const messageDraft = selectedPersonId ? drafts[selectedPersonId] || '' : '';
  const setMessageDraft = (value: string | ((current: string) => string)) => {
    if (!selectedPersonId) return;
    setDrafts((current) => ({ ...current, [selectedPersonId]: typeof value === 'function' ? value(current[selectedPersonId] || '') : value }));
  };
  const [choosingPerson, setChoosingPerson] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // Sending failed (shown above the conversation).
  const [dmError, setDmError] = useState('');
  // The list of people/conversations failed to load.
  const [listError, setListError] = useState('');
  const [listReloadKey, setListReloadKey] = useState(0);
  // The open conversation's messages failed to load.
  const [conversationError, setConversationError] = useState('');
  const [conversationReloadKey, setConversationReloadKey] = useState(0);

  // A person opened from a profile ("Message" button) may not be in the
  // member preview list, so keep a placeholder entry for them.
  useEffect(() => {
    if (!params.userId) return;
    setSelectedPersonId(params.userId);
    setPendingPerson({ id: params.userId, name: params.name || 'Member', handle: null });
  }, [params.userId, params.name]);

  const loadThreads = useCallback(async () => {
    if (!hasAccountSession) return [];
    const result = await api.listDirectThreads(sessionToken);
    setThreads(result.threads);
    return result.threads;
  }, [hasAccountSession, sessionToken]);

  useEffect(() => {
    if (!hasAccountSession) return;

    setLoadingList(true);
    Promise.all([loadThreads(), api.listDirectMembers(sessionToken)])
      .then(([threadResult, memberResult]) => {
        setMembers(memberResult.members);
        // Only open a thread the viewer asked for (tap, profile, or
        // notification) - auto-opening one would mark it read unseen.
        const fromNotification = params.groupId
          ? threadResult.find((thread) => thread.groupId === params.groupId)
          : undefined;
        if (fromNotification) {
          setSelectedPersonId((current) => current ?? fromNotification.person.id);
        }
        setListError('');
      })
      .catch((error) => {
        console.error('Failed to load direct messages:', error);
        setListError(friendlyError(error, "We couldn't load your messages."));
      }).finally(() => setLoadingList(false));
  }, [hasAccountSession, loadThreads, params.groupId, sessionToken, listReloadKey]);

  const conversations = useMemo(() => {
    const byPerson = new Map<string, Conversation>();
    threads.forEach((thread) => byPerson.set(thread.person.id, threadToConversation(thread)));
    if (pendingPerson && !byPerson.has(pendingPerson.id)) {
      const member = members.find((item) => item.id === pendingPerson.id);
      byPerson.set(
        pendingPerson.id,
        member ? memberToConversation(member) : memberToConversation({ ...pendingPerson, handle: pendingPerson.handle || '', role: '' }),
      );
    }
    members.forEach((member) => {
      if (!byPerson.has(member.id)) byPerson.set(member.id, memberToConversation(member));
    });
    return [...byPerson.values()];
  }, [members, pendingPerson, threads]);

  const visibleConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const items = choosingPerson ? conversations : conversations.filter((conversation) => !!conversation.groupId);
    items.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '') || a.person.name.localeCompare(b.person.name));
    if (!query) return items;
    return items.filter((conversation) =>
      [conversation.person.name, conversation.person.handle || '', conversation.preview]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [conversations, searchQuery, choosingPerson]);

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.person.id === selectedPersonId) ?? null,
    [conversations, selectedPersonId],
  );
  const selectedGroupId = selected?.groupId ?? null;

  const selectedGroupIdRef = useRef(selectedGroupId);
  selectedGroupIdRef.current = selectedGroupId;
  // Newest incoming message already marked read, per thread, so polling only
  // calls markDirectRead when something new has arrived.
  const markedReadRef = useRef<Record<string, string>>({});

  const loadMessages = useCallback(
    async (groupId: string) => {
      const result = await api.listDirectMessages(groupId, sessionToken);
      // Ignore a late response for a thread the viewer has switched away from.
      if (selectedGroupIdRef.current !== groupId) return;
      setMessages(result.messages);

      const newestIncoming = [...result.messages].reverse().find((message) => !message.fromMe);
      if (newestIncoming && markedReadRef.current[groupId] !== newestIncoming.id) {
        markedReadRef.current[groupId] = newestIncoming.id;
        await api.markDirectThreadRead(groupId, sessionToken);
        setThreads((current) =>
          current.map((thread) => (thread.groupId === groupId ? { ...thread, unreadCount: 0 } : thread)),
        );
      }
    },
    [sessionToken],
  );

  useEffect(() => {
    setMessages([]);
    setConversationError('');
    if (!selectedGroupId) return;
    setIsLoadingMessages(true);
    loadMessages(selectedGroupId)
      .catch((error) => {
        console.error('Failed to load conversation:', error);
        setConversationError(friendlyError(error, "We couldn't load this conversation."));
      })
      .finally(() => setIsLoadingMessages(false));
  }, [loadMessages, selectedGroupId, conversationReloadKey]);

  // Poll while the screen is focused so replies show up without a reload.
  useFocusEffect(
    useCallback(() => {
      if (!hasAccountSession) return undefined;
      const interval = setInterval(() => {
        loadThreads().catch(() => undefined);
        const groupId = selectedGroupIdRef.current;
        if (groupId) loadMessages(groupId).catch(() => undefined);
      }, POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    }, [hasAccountSession, loadMessages, loadThreads]),
  );

  const unreadCount = threads.reduce((total, thread) => total + thread.unreadCount, 0);

  const sendMessage = async () => {
    const content = messageDraft.trim();
    if (!content || !selected || !sessionToken || isSending) return;

    setIsSending(true);
    setPendingBody(content);
    setMessageDraft('');
    let sent = false;
    try {
      const groupId =
        selected.groupId ?? (await api.openDirectThread(selected.person.id, sessionToken)).groupId;
      const result = await api.sendDirectMessage(groupId, content, sessionToken);
      sent = true;
      // A poll may have already picked it up while the send was in flight.
      setMessages((current) =>
        current.some((message) => message.id === result.message.id) ? current : [...current, result.message],
      );
      setPendingBody(null);
      setDmError('');
      await loadThreads();
      // Picks up an immediate reply (e.g. from Sage) in the same round trip.
      await loadMessages(groupId);
    } catch (error) {
      console.error('Failed to send direct message:', error);
      if (!sent) {
        // Put the note back unless they've already started typing another one.
        setMessageDraft((current) => current || content);
        setDmError(friendlyError(error, "We couldn't send your message. It's still in the box."));
      }
    } finally {
      setPendingBody(null);
      setIsSending(false);
    }
  };

  if (!hasAccountSession) {
    return (
      <View className="flex-1 bg-white">
        <View className="px-5 pb-4" style={{ backgroundColor: '#FFFFFF', paddingTop: insets.top + 16 }}>
          <Text className="text-2xl font-bold text-gray-900">Direct messages</Text>
          <Text className="text-sm text-gray-600">Create an account before sending private messages</Text>
        </View>
        <View className="flex-1 justify-center px-6">
          <View className="rounded-xl border border-stone-200 bg-white p-5">
            <View className="mb-3 flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-white">
                <ShieldCheck size={21} color="#047857" />
              </View>
              <View className="flex-1">
                <Text className="text-xl font-black text-gray-900">Account needed for DMs</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">
                  You can read the Commons without signing in. Private follow-up needs an email-verified account.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/', params: { entry: 'sign-in' } })}
              className="mt-2 h-12 items-center justify-center rounded-xl bg-emerald-800"
            >
              <Text className="font-black text-white">Create account</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-white" behavior={keyboardAvoidingBehavior}>
      <View className="border-b border-gray-200 bg-white px-5 pb-4" style={{ paddingTop: insets.top + 16 }}>
        <View className="flex-row items-center gap-3">
          {selected || choosingPerson ? (
            <TouchableOpacity
              accessibilityRole="button" accessibilityLabel="Back to conversations"
              onPress={() => { setSelectedPersonId(null); setChoosingPerson(false); setSearchQuery(''); setDmError(''); }}
              className="h-11 w-11 items-center justify-center"
              disabled={isSending}
            ><ArrowLeft size={22} color={CommunityTheme.ink} /></TouchableOpacity>
          ) : null}
          <View className="flex-1">
            <Text className="text-2xl font-bold text-gray-900">{choosingPerson && !selected ? 'New message' : 'Direct messages'}</Text>
            {!selected ? <Text className="mt-1 text-sm text-gray-500">{choosingPerson ? 'Choose someone to message.' : unreadCount > 0 ? `${unreadCount} unread messages` : 'Your conversations'}</Text> : null}
          </View>
          {!selected && !choosingPerson ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="New message"
              onPress={() => { setChoosingPerson(true); setSearchQuery(''); }}
              className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200">
              <Plus size={22} color={CommunityTheme.primary} />
            </TouchableOpacity>
          ) : null}
        </View>
        {!selected ? (
          <View className="mt-4 flex-row items-center gap-2 rounded-xl border border-gray-200 bg-white px-3">
            <Search size={17} color={CommunityTheme.muted} />
            <TextInput value={searchQuery} onChangeText={setSearchQuery}
              placeholder={choosingPerson ? 'Search people' : 'Search conversations'}
              accessibilityLabel={choosingPerson ? 'Search people' : 'Search conversations'}
              placeholderTextColor={CommunityTheme.muted} autoCapitalize="none"
              className="h-11 flex-1 text-base text-gray-900" />
            {searchQuery ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearchQuery('')} className="h-11 justify-center px-2"><Text style={{ color: CommunityTheme.primary }}>Clear</Text></TouchableOpacity> : null}
          </View>
        ) : null}
      </View>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }} {...keyboardScrollProps}>
        {!selected ? (
          <View className="px-5">
            {loadingList ? <ActivityIndicator accessibilityLabel="Loading conversations" className="my-6" color={CommunityTheme.primary} /> : listError ? (
              <LoadError message={listError} onRetry={() => setListReloadKey((key) => key + 1)} />
            ) : visibleConversations.length === 0 ? (
              <View className="py-8">
                <Text className="text-lg font-semibold text-gray-900">{searchQuery ? 'No matches' : choosingPerson ? 'No people to message yet' : 'No conversations yet'}</Text>
                <Text className="mt-2 text-base text-gray-600">{searchQuery ? 'Try another name or clear your search.' : choosingPerson ? 'People you can message will appear here.' : 'Tap New message to start a conversation.'}</Text>
              </View>
            ) : visibleConversations.map((conversation) => (
              <TouchableOpacity key={conversation.person.id} accessibilityRole="button"
                accessibilityLabel={`Conversation with ${conversation.person.name}`}
                onPress={() => { setSelectedPersonId(conversation.person.id); setChoosingPerson(false); setDmError(''); }}
                className="flex-row items-center gap-3 border-b border-gray-200 py-4">
                {conversation.person.isSage ? <SageAvatar size={40} /> : (
                  <View className="h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white"><Text className="font-semibold text-gray-700">{conversation.person.name.slice(0, 1)}</Text></View>
                )}
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="flex-1 font-semibold text-gray-900" numberOfLines={1}>{conversation.person.name}{conversation.person.isSage ? ' · AI assistant' : ''}</Text>
                    {conversation.lastMessageAt ? <Text className="text-xs text-gray-500">{formatMessageTime(conversation.lastMessageAt)}</Text> : null}
                  </View>
                  {choosingPerson && conversation.person.handle ? <Text className="mt-1 text-xs text-gray-500">@{conversation.person.handle}</Text> : null}
                  <Text className="mt-1 text-sm text-gray-600" numberOfLines={2}>{conversation.preview}</Text>
                </View>
                {conversation.unreadCount > 0 ? <View accessibilityLabel={`${conversation.unreadCount} unread`} className="min-w-6 items-center rounded-full px-2 py-1" style={{ backgroundColor: CommunityTheme.primary }}><Text className="text-xs font-bold text-white">{conversation.unreadCount}</Text></View> : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        <View className="px-5 py-4">
          {dmError ? (
            <View className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
              <Text className="text-sm font-semibold text-red-700">{dmError}</Text>
            </View>
          ) : null}

          {selected ? (
          <View className="rounded-xl border border-stone-200 bg-white">
            <View className="flex-row items-center gap-3 border-b border-stone-100 p-4">
              {selected.person.isSage ? (
                <SageAvatar size={44} motion="blink" />
              ) : (
                <View className="h-11 w-11 items-center justify-center rounded-xl bg-white">
                  <Text className="font-black text-emerald-900">{selected.person.name.slice(0, 1)}</Text>
                </View>
              )}
              <View className="flex-1">
                <Text className="font-black text-gray-900">{selected.person.name}</Text>
                <View className="flex-row items-center gap-1">
                  <Lock size={11} color="#6B7280" />
                  <Text className="text-xs font-semibold text-gray-500">{selected.person.isSage ? 'Private conversation · AI assistant' : 'Private circle · only you two'}</Text>
                </View>
              </View>
            </View>

            <View className="gap-3 p-4">
              {isLoadingMessages && messages.length === 0 ? (
                <ActivityIndicator size="small" color="#047857" />
              ) : null}
              {conversationError && !isLoadingMessages && messages.length === 0 ? (
                <LoadError
                  message={conversationError}
                  onRetry={() => setConversationReloadKey((key) => key + 1)}
                />
              ) : null}
              {!isLoadingMessages && !conversationError && messages.length === 0 ? (
                <View className="rounded-xl bg-white px-4 py-3">
                  <Text className="text-sm leading-5 text-gray-700">
                    No private messages yet. Send the first note when it should not be public.
                  </Text>
                </View>
              ) : null}
              {messages.map((message) => (
                <View
                  key={message.id}
                  className={`max-w-[86%] rounded-xl px-4 py-3 ${
                    message.fromMe ? 'self-end bg-emerald-800' : 'self-start bg-white'
                  }`}
                >
                  <MentionText
                    content={message.body}
                    style={{ fontSize: 14, lineHeight: 20, color: message.fromMe ? '#FFFFFF' : '#1F2937' }}
                    mentionClassName={message.fromMe ? 'font-bold text-white underline' : 'font-bold text-red-700'}
                  />
                  <View className={`mt-1 flex-row items-center gap-1 ${message.fromMe ? 'self-end' : 'self-start'}`}>
                    <Text className={`text-xs ${message.fromMe ? 'text-white/60' : 'text-gray-400'}`}>
                      {formatMessageTime(message.createdAt)}
                    </Text>
                    {message.fromMe ? <CheckCheck size={12} color="#D1FAE5" /> : null}
                  </View>
                </View>
              ))}
              {pendingBody ? (
                <View className="max-w-[86%] self-end rounded-xl bg-emerald-800 px-4 py-3" style={{ opacity: 0.7 }}>
                  <MentionText
                    content={pendingBody}
                    style={{ fontSize: 14, lineHeight: 20, color: '#FFFFFF' }}
                    mentionClassName="font-bold text-white underline"
                  />
                </View>
              ) : null}
              {isSending && selected.person.isSage ? (
                <View className="flex-row items-center gap-2 self-start">
                  <SageAvatar size={32} motion="thinking" />
                  <View className="rounded-xl bg-white px-4 py-3">
                    <Text className="text-sm text-gray-500">Sage is thinking…</Text>
                  </View>
                </View>
              ) : null}
            </View>

            {selectedGroupId ? (
              <View className="px-4 pb-2">
                <SageDecisionTrails filter={{ circleId: selectedGroupId }} sessionToken={sessionToken} refreshKey={messages.length} hideWhenEmpty />
              </View>
            ) : null}
          </View>
          ) : null}

        </View>
      </ScrollView>

      {selected ? (
        // Pinned below the conversation so it rides up with the keyboard and
        // Send is always reachable; dragging the conversation down hides the keyboard.
        <View className="border-t border-stone-200 bg-white px-4 py-3">
          <View className="flex-row items-end gap-2">
            <TextInput
              value={messageDraft}
              onChangeText={setMessageDraft}
              placeholder={`Message ${selected.person.name}`}
              accessibilityLabel={`Message ${selected.person.name}`}
              placeholderTextColor="#78716C"
              multiline
              className="min-h-11 flex-1 rounded-xl border border-stone-200 bg-white px-4 py-3 text-base text-gray-900"
              style={{ maxHeight: 96, textAlignVertical: 'top' }}
            />
            <TouchableOpacity
              onPress={sendMessage}
              disabled={isSending}
              accessibilityLabel="Send message"
              accessibilityRole="button"
              className="h-11 w-11 items-center justify-center rounded-xl"
              style={{ opacity: isSending ? 0.6 : 1, backgroundColor: CommunityTheme.primary }}
              activeOpacity={0.8}
            >
              {isSending ? <ActivityIndicator size="small" color="white" /> : <Send size={18} color="white" />}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
