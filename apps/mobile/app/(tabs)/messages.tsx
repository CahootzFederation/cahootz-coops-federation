// Hallmark - pre-emit critique: P4 H4 E4 S4 R4 V4
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import {
  CheckCheck,
  MessageCircle,
  Search,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { api, type DirectMember } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

type DirectThread = {
  id: string;
  name: string;
  role: string;
  time: string;
  unread: number;
  preview: string;
  online?: boolean;
  messages: {
    id: string;
    fromMe: boolean;
    body: string;
    time: string;
  }[];
};

const memberToThread = (member: DirectMember): DirectThread => ({
  id: member.id,
  name: member.name,
  role: member.role,
  time: '',
  unread: 0,
  preview: 'Start a private follow-up',
  messages: [],
});

export default function MessagesScreen() {
  const { isAuthenticated, sessionToken } = useAuth();
  const hasAccountSession = isAuthenticated && !!sessionToken;
  const [threads, setThreads] = useState<DirectThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dmError, setDmError] = useState('');

  useEffect(() => {
    if (!hasAccountSession) return;

    Promise.all([
      api.listDirectThreads(sessionToken),
      api.listDirectMembers(sessionToken),
    ])
      .then(([threadResult, memberResult]) => {
        const existingThreadIds = new Set(threadResult.threads.map((thread) => thread.id));
        const memberThreads = memberResult.members
          .filter((member) => !existingThreadIds.has(member.id))
          .map(memberToThread);
        const nextThreads = [...threadResult.threads, ...memberThreads];

        setThreads(nextThreads);
        setSelectedThreadId((current) => current || nextThreads[0]?.id || null);
        setDmError('');
      })
      .catch((error) => {
        console.error('Failed to load direct messages:', error);
        setDmError(error instanceof Error ? error.message : 'Could not load direct messages.');
      });
  }, [hasAccountSession, sessionToken]);

  const visibleThreads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return threads;

    return threads.filter((thread) => {
      const haystack = [
        thread.name,
        thread.role,
        thread.preview,
        ...thread.messages.map((message) => message.body),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [searchQuery, threads]);

  const selectedThread = useMemo(
    () =>
      visibleThreads.find((thread) => thread.id === selectedThreadId) ??
      visibleThreads[0] ??
      threads[0] ??
      null,
    [selectedThreadId, threads, visibleThreads]
  );

  useEffect(() => {
    if (visibleThreads.length === 0) return;
    if (!visibleThreads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(visibleThreads[0].id);
    }
  }, [selectedThreadId, visibleThreads]);

  const unreadCount = threads.reduce((total, thread) => total + thread.unread, 0);

  const sendMessage = async () => {
    const content = messageDraft.trim();
    if (!content || !selectedThread) return;

    if (sessionToken) {
      try {
        const result = await api.sendDirectMessage({ receiverId: selectedThread.id, content }, sessionToken);
        setThreads((current) =>
          current.map((thread) =>
            thread.id === selectedThread.id
              ? {
                  ...thread,
                  preview: result.message.body,
                  time: 'now',
                  messages: [
                    ...thread.messages,
                    {
                      id: result.message.id,
                      fromMe: true,
                      body: result.message.body,
                      time: 'now',
                    },
                  ],
                }
              : thread
          )
        );
        setDmError('');
        setMessageDraft('');
      } catch (error) {
        console.error('Failed to send direct message:', error);
        setDmError(error instanceof Error ? error.message : 'Could not send message.');
      }
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
            <Text className="text-sm text-white/75">Private follow-up, public action when ready</Text>
          </View>
          <View className="h-10 min-w-10 items-center justify-center rounded-xl bg-white/12 px-3">
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
              {visibleThreads.map((thread) => {
                const selected = selectedThread?.id === thread.id;
                return (
                  <TouchableOpacity
                    key={thread.id}
                    onPress={() => setSelectedThreadId(thread.id)}
                    className={`w-44 rounded-xl border p-3 ${
                      selected ? 'border-emerald-700 bg-emerald-50' : 'border-stone-200 bg-white'
                    }`}
                    activeOpacity={0.75}
                  >
                    <View className="mb-2 flex-row items-center gap-2">
                      <View className="h-9 w-9 items-center justify-center rounded-xl bg-stone-100">
                        <Text className="font-black text-stone-700">{thread.name.slice(0, 1)}</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="font-bold text-gray-900">{thread.name}</Text>
                        <Text className="text-xs text-gray-500">{thread.role}</Text>
                      </View>
                      {thread.unread > 0 ? (
                        <View className="h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1">
                          <Text className="text-xs font-black text-white">{thread.unread}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text className="text-xs leading-4 text-stone-600" numberOfLines={2}>
                      {thread.preview}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          {visibleThreads.length === 0 ? (
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

          {!selectedThread ? (
            <View className="rounded-xl border border-stone-200 bg-white p-5">
              <Text className="text-lg font-black text-gray-900">No conversation selected</Text>
              <Text className="mt-1 text-sm leading-5 text-gray-600">
                Search for a Commons member above to start a private follow-up.
              </Text>
            </View>
          ) : (
          <View className="rounded-xl border border-stone-200 bg-white">
            <View className="flex-row items-center gap-3 border-b border-stone-100 p-4">
              <View className="relative h-11 w-11 items-center justify-center rounded-xl bg-emerald-100">
                <Text className="font-black text-emerald-900">{selectedThread.name.slice(0, 1)}</Text>
                {selectedThread.online ? (
                  <View className="absolute -right-1 -top-1 h-3 w-3 rounded-full border border-white bg-green-500" />
                ) : null}
              </View>
              <View className="flex-1">
                <Text className="font-black text-gray-900">{selectedThread.name}</Text>
                <Text className="text-xs font-semibold text-gray-500">{selectedThread.role}</Text>
              </View>
            </View>

            <View className="gap-3 p-4">
              {selectedThread.messages.length === 0 ? (
                <View className="rounded-xl bg-stone-100 px-4 py-3">
                  <Text className="text-sm leading-5 text-gray-700">
                    No private messages yet. Send the first note when it should not be public.
                  </Text>
                </View>
              ) : null}
              {selectedThread.messages.map((message) => (
                <View
                  key={message.id}
                  className={`max-w-[86%] rounded-xl px-4 py-3 ${
                    message.fromMe ? 'self-end bg-emerald-800' : 'self-start bg-stone-100'
                  }`}
                >
                  <Text className={`text-sm leading-5 ${message.fromMe ? 'text-white' : 'text-gray-800'}`}>
                    {message.body}
                  </Text>
                  <View className={`mt-1 flex-row items-center gap-1 ${message.fromMe ? 'self-end' : 'self-start'}`}>
                    <Text className={`text-xs ${message.fromMe ? 'text-white/60' : 'text-gray-400'}`}>
                      {message.time}
                    </Text>
                    {message.fromMe ? <CheckCheck size={12} color="#D1FAE5" /> : null}
                  </View>
                </View>
              ))}
            </View>

            <View className="border-t border-stone-100 p-3">
              <View className="flex-row items-end gap-2">
                <TextInput
                  value={messageDraft}
                  onChangeText={setMessageDraft}
                  placeholder={`Message ${selectedThread.name}`}
                  placeholderTextColor="#78716C"
                  multiline
                  className="min-h-11 flex-1 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-base text-gray-900"
                  style={{ maxHeight: 96, textAlignVertical: 'top' }}
                />
                <TouchableOpacity
                  onPress={sendMessage}
                  className="h-11 w-11 items-center justify-center rounded-xl bg-red-600"
                  activeOpacity={0.8}
                >
                  <Send size={18} color="white" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
          )}

          <View className="mt-4 rounded-xl border border-emerald-900/10 bg-emerald-950 p-4">
            <View className="flex-row items-start gap-3">
              <ShieldCheck size={21} color="#FBBF24" />
              <View className="flex-1">
                <Text className="font-bold text-white">DMs should stay secondary</Text>
                <Text className="mt-1 text-sm leading-5 text-white/75">
                  One-to-one chat is for sensitive follow-up, steward outreach, and coordination. The main community knowledge should live in posts and comments.
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
                  AI can turn a private exchange into a public update without exposing sensitive details.
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
