// Hallmark - pre-emit critique: P4 H4 E4 S4 R4 V4
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  CheckCheck,
  Lock,
  MessageCircle,
  Search,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { MentionText } from '@/components/mention-text';
import {
  api,
  type DirectMember,
  type DirectMessage,
  type DirectPerson,
  type DirectThread,
} from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { SageDecisionTrails } from '@/components/sage-decision-trail';

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
    person: { id: member.id, name: member.name, handle: member.handle },
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
  const hasAccountSession = isAuthenticated && !!sessionToken;
  const [threads, setThreads] = useState<DirectThread[]>([]);
  const [members, setMembers] = useState<DirectMember[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [pendingPerson, setPendingPerson] = useState<DirectPerson | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dmError, setDmError] = useState('');

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
        setDmError('');
      })
      .catch((error) => {
        console.error('Failed to load direct messages:', error);
        setDmError(error instanceof Error ? error.message : 'Could not load direct messages.');
      });
  }, [hasAccountSession, loadThreads, params.groupId, sessionToken]);

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
    if (!query) return conversations;
    return conversations.filter((conversation) =>
      [conversation.person.name, conversation.person.handle || '', conversation.preview]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [conversations, searchQuery]);

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
      if (selectedGroupIdRef.current && selectedGroupIdRef.current !== groupId) return;
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
    if (!selectedGroupId) return;
    setIsLoadingMessages(true);
    loadMessages(selectedGroupId)
      .catch((error) => {
        console.error('Failed to load conversation:', error);
        setDmError(error instanceof Error ? error.message : 'Could not load messages.');
      })
      .finally(() => setIsLoadingMessages(false));
  }, [loadMessages, selectedGroupId]);

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
    try {
      const groupId =
        selected.groupId ?? (await api.openDirectThread(selected.person.id, sessionToken)).groupId;
      const result = await api.sendDirectMessage(groupId, content, sessionToken);
      setMessages((current) => [...current, result.message]);
      setMessageDraft('');
      setDmError('');
      await loadThreads();
      // Picks up an immediate reply (e.g. from Sage) in the same round trip.
      await loadMessages(groupId);
    } catch (error) {
      console.error('Failed to send direct message:', error);
      setDmError(error instanceof Error ? error.message : 'Could not send message.');
    } finally {
      setIsSending(false);
    }
  };

  if (!hasAccountSession) {
    return (
      <View className="flex-1 bg-stone-50">
        <View className="px-5 pt-14 pb-4" style={{ backgroundColor: '#12362D' }}>
          <Text className="text-2xl font-black text-white">Direct messages</Text>
          <Text className="text-sm text-white/75">Create an account before sending private messages</Text>
        </View>
        <View className="flex-1 justify-center px-6">
          <View className="rounded-xl border border-stone-200 bg-white p-5">
            <View className="mb-3 flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-emerald-100">
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
    <View className="flex-1 bg-stone-50">
      <View className="px-5 pt-14 pb-4" style={{ backgroundColor: '#12362D' }}>
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-black text-white">Direct messages</Text>
            <Text className="text-sm text-white/75">Private circles for two</Text>
          </View>
          <View
            className="h-10 min-w-10 items-center justify-center rounded-xl bg-white/12 px-3"
            accessibilityLabel={`${unreadCount} unread messages`}
          >
            <Text className="text-sm font-black text-white">{unreadCount}</Text>
          </View>
        </View>

        <View className="mt-4 flex-row items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
          <Search size={17} color="#F9F7EF" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search people and messages"
            placeholderTextColor="rgba(249, 247, 239, 0.7)"
            autoCapitalize="none"
            className="h-10 flex-1 text-sm text-white"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text className="text-xs font-bold text-amber-200">Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="border-b border-stone-200 bg-white px-5 py-3">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-3">
              {visibleConversations.map((conversation) => {
                const isSelected = selected?.person.id === conversation.person.id;
                return (
                  <TouchableOpacity
                    key={conversation.person.id}
                    onPress={() => setSelectedPersonId(conversation.person.id)}
                    accessibilityLabel={`Conversation with ${conversation.person.name}`}
                    className={`w-44 rounded-xl border p-3 ${
                      isSelected ? 'border-emerald-700 bg-emerald-50' : 'border-stone-200 bg-white'
                    }`}
                    activeOpacity={0.75}
                  >
                    <View className="mb-2 flex-row items-center gap-2">
                      <View className="h-9 w-9 items-center justify-center rounded-xl bg-stone-100">
                        <Text className="font-black text-stone-700">{conversation.person.name.slice(0, 1)}</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="font-bold text-gray-900" numberOfLines={1}>
                          {conversation.person.name}
                        </Text>
                        {conversation.person.handle ? (
                          <Text className="text-xs text-gray-500" numberOfLines={1}>
                            @{conversation.person.handle}
                          </Text>
                        ) : null}
                      </View>
                      {conversation.unreadCount > 0 ? (
                        <View
                          className="h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1"
                          accessibilityLabel={`${conversation.unreadCount} unread`}
                        >
                          <Text className="text-xs font-black text-white">{conversation.unreadCount}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text className="text-xs leading-4 text-stone-600" numberOfLines={2}>
                      {conversation.preview}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          {visibleConversations.length === 0 ? (
            <View className="mt-3 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4">
              <Text className="font-bold text-gray-900">
                {searchQuery ? 'No messages found' : 'No Commons members yet'}
              </Text>
              <Text className="mt-1 text-sm text-gray-600">
                {searchQuery
                  ? 'Clear search or try another name.'
                  : 'As people create accounts, they will appear here for private follow-up.'}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="px-5 py-4">
          {dmError ? (
            <View className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
              <Text className="text-sm font-semibold text-red-700">{dmError}</Text>
            </View>
          ) : null}

          {!selected ? (
            <View className="rounded-xl border border-stone-200 bg-white p-5">
              <Text className="text-lg font-black text-gray-900">No conversation selected</Text>
              <Text className="mt-1 text-sm leading-5 text-gray-600">
                Pick a conversation above, or search for a Commons member to start a private follow-up.
              </Text>
            </View>
          ) : (
          <View className="rounded-xl border border-stone-200 bg-white">
            <View className="flex-row items-center gap-3 border-b border-stone-100 p-4">
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-emerald-100">
                <Text className="font-black text-emerald-900">{selected.person.name.slice(0, 1)}</Text>
              </View>
              <View className="flex-1">
                <Text className="font-black text-gray-900">{selected.person.name}</Text>
                <View className="flex-row items-center gap-1">
                  <Lock size={11} color="#6B7280" />
                  <Text className="text-xs font-semibold text-gray-500">Private circle · only you two</Text>
                </View>
              </View>
            </View>

            <View className="gap-3 p-4">
              {isLoadingMessages && messages.length === 0 ? (
                <ActivityIndicator size="small" color="#047857" />
              ) : null}
              {!isLoadingMessages && messages.length === 0 ? (
                <View className="rounded-xl bg-stone-100 px-4 py-3">
                  <Text className="text-sm leading-5 text-gray-700">
                    No private messages yet. Send the first note when it should not be public.
                  </Text>
                </View>
              ) : null}
              {messages.map((message) => (
                <View
                  key={message.id}
                  className={`max-w-[86%] rounded-xl px-4 py-3 ${
                    message.fromMe ? 'self-end bg-emerald-800' : 'self-start bg-stone-100'
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
            </View>

            {selectedGroupId ? (
              <View className="px-4 pb-2">
                <SageDecisionTrails filter={{ circleId: selectedGroupId }} sessionToken={sessionToken} refreshKey={messages.length} hideWhenEmpty />
              </View>
            ) : null}

            <View className="border-t border-stone-100 p-3">
              <View className="flex-row items-end gap-2">
                <TextInput
                  value={messageDraft}
                  onChangeText={setMessageDraft}
                  placeholder={`Message ${selected.person.name}`}
                  accessibilityLabel={`Message ${selected.person.name}`}
                  placeholderTextColor="#78716C"
                  multiline
                  className="min-h-11 flex-1 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-base text-gray-900"
                  style={{ maxHeight: 96, textAlignVertical: 'top' }}
                />
                <TouchableOpacity
                  onPress={sendMessage}
                  disabled={isSending}
                  accessibilityLabel="Send message"
                  className="h-11 w-11 items-center justify-center rounded-xl bg-red-600"
                  style={{ opacity: isSending ? 0.6 : 1 }}
                  activeOpacity={0.8}
                >
                  {isSending ? <ActivityIndicator size="small" color="white" /> : <Send size={18} color="white" />}
                </TouchableOpacity>
              </View>
            </View>
          </View>
          )}

          <View className="mt-4 rounded-xl border border-emerald-900/10 bg-emerald-950 p-4">
            <View className="flex-row items-start gap-3">
              <ShieldCheck size={21} color="#FFB370" />
              <View className="flex-1">
                <Text className="font-bold text-white">DMs should stay secondary</Text>
                <Text className="mt-1 text-sm leading-5 text-white/75">
                  Each DM is a private circle only the two of you can see. Use it for sensitive follow-up, steward outreach, and coordination. The main community knowledge should live in posts and comments.
                </Text>
              </View>
            </View>
          </View>

          <View className="mt-4 rounded-xl border border-dashed border-stone-300 bg-white p-4">
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-stone-100">
                <Users size={20} color="#57534E" />
              </View>
              <View className="flex-1">
                <Text className="font-bold text-gray-900">Move useful details back to comments</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">
                  When a private exchange turns into something the commons should know, share it as a post.
                </Text>
              </View>
              <MessageCircle size={18} color="#78716C" />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
