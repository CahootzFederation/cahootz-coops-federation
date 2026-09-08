import React from 'react';
import { ActivityIndicator, Alert, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { ArrowLeft, Copy, Crown, LogOut, RefreshCw, Send, Users } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import {
  api,
  type PrivateGroupComment,
  type PrivateGroupDetail,
  type PrivateGroupMember,
} from '@/lib/api';

const THEME = {
  paper: '#F8FAFC',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
  muted: '#64748B',
};

function formatTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function GroupDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { user, isLoading, isAuthenticated, sessionToken } = useAuth();

  const [group, setGroup] = React.useState<PrivateGroupDetail | null>(null);
  const [members, setMembers] = React.useState<PrivateGroupMember[]>([]);
  const [comments, setComments] = React.useState<PrivateGroupComment[]>([]);
  const [isLoadingGroup, setIsLoadingGroup] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [isPosting, setIsPosting] = React.useState(false);
  const [isRegenerating, setIsRegenerating] = React.useState(false);
  const [transferringUserId, setTransferringUserId] = React.useState<string | null>(null);
  const [isLeaving, setIsLeaving] = React.useState(false);

  React.useEffect(() => {
    if (isLoading || (isAuthenticated && sessionToken)) return;

    router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
  }, [isAuthenticated, isLoading, sessionToken]);

  const load = React.useCallback(() => {
    if (!sessionToken || !groupId) return;

    setIsLoadingGroup(true);
    setError(null);
    Promise.all([
      api.getGroupDetail(groupId, sessionToken),
      api.listGroupComments(groupId, sessionToken),
    ])
      .then(([detail, commentsResult]) => {
        setGroup(detail.group);
        setMembers(detail.members);
        setComments(commentsResult.comments);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load group.'))
      .finally(() => setIsLoadingGroup(false));
  }, [groupId, sessionToken]);

  React.useEffect(() => {
    load();
  }, [load]);

  const copyInviteCode = async () => {
    if (!group?.inviteCode) return;
    await Clipboard.setStringAsync(group.inviteCode);
    Alert.alert('Copied', 'Invite code copied to clipboard.');
  };

  const regenerateCode = async () => {
    if (!sessionToken || !groupId || isRegenerating) return;

    setIsRegenerating(true);
    try {
      const { inviteCode } = await api.regenerateGroupInviteCode(groupId, sessionToken);
      setGroup((current) => (current ? { ...current, inviteCode } : current));
    } catch (err) {
      Alert.alert('Could not regenerate code', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const makeLeader = (newLeaderUserId: string, name: string) => {
    if (!sessionToken || !groupId) return;

    Alert.alert('Transfer leadership', `Make ${name} the leader of this space?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Transfer',
        style: 'destructive',
        onPress: async () => {
          setTransferringUserId(newLeaderUserId);
          try {
            await api.transferGroupLeadership(groupId, newLeaderUserId, sessionToken);
            load();
          } catch (err) {
            Alert.alert('Could not transfer leadership', err instanceof Error ? err.message : 'Try again.');
          } finally {
            setTransferringUserId(null);
          }
        },
      },
    ]);
  };

  const leaveGroup = () => {
    if (!sessionToken || !groupId) return;

    Alert.alert('Leave space', 'Are you sure you want to leave this space?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          setIsLeaving(true);
          try {
            await api.leaveGroup(groupId, sessionToken);
            router.back();
          } catch (err) {
            Alert.alert('Could not leave space', err instanceof Error ? err.message : 'Try again.');
            setIsLeaving(false);
          }
        },
      },
    ]);
  };

  const postComment = async () => {
    const content = draft.trim();
    if (!content || !sessionToken || !groupId || isPosting) return;

    setIsPosting(true);
    try {
      const { comment } = await api.addGroupComment(groupId, content, sessionToken);
      setComments((current) => [...current, comment]);
      setDraft('');
    } catch (err) {
      Alert.alert('Could not post', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setIsPosting(false);
    }
  };

  if (isLoading || !isAuthenticated || !sessionToken || isLoadingGroup) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <ActivityIndicator size="small" color={THEME.primary} />
      </View>
    );
  }

  if (error || !group) {
    return (
      <SafeAreaView className="flex-1 bg-white px-6">
        <TouchableOpacity onPress={() => router.back()} className="mt-4 flex-row items-center gap-2">
          <ArrowLeft size={18} color="#1F2937" />
          <Text className="text-sm font-bold text-gray-700">Back</Text>
        </TouchableOpacity>
        <View className="flex-1 items-center justify-center">
          <Text className="text-base font-black text-gray-900">{error || 'Group not found'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: THEME.paper }}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="border-b bg-white px-3 pt-3 pb-2" style={{ borderColor: THEME.border }}>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={() => router.back()}
              className="h-9 w-9 items-center justify-center rounded-full border bg-white"
              style={{ borderColor: THEME.border }}
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={18} color="#1F2937" strokeWidth={2.6} />
            </TouchableOpacity>
            <View className="min-w-0 flex-1">
              <Text className="text-[10px] font-black uppercase text-gray-500">
                {group.privacy.replace('-', ' ')}
              </Text>
              <Text className="text-base font-black text-gray-950" numberOfLines={1}>
                {group.name}
              </Text>
            </View>
            <TouchableOpacity
              onPress={leaveGroup}
              disabled={isLeaving}
              className="h-9 w-9 items-center justify-center rounded-full border bg-white"
              style={{ borderColor: THEME.border }}
              accessibilityLabel="Leave group"
            >
              {isLeaving ? <ActivityIndicator size="small" color="#DC2626" /> : <LogOut size={16} color="#DC2626" />}
            </TouchableOpacity>
          </View>
        </View>

        <View className="px-5 py-4">
          {group.purpose ? (
            <View className="rounded-2xl border bg-white p-4" style={{ borderColor: THEME.border }}>
              <Text className="text-sm leading-5 text-gray-700">{group.purpose}</Text>
            </View>
          ) : null}

          {group.isLeader && group.inviteCode ? (
            <View className="mt-4 rounded-2xl border bg-white p-4" style={{ borderColor: THEME.border }}>
              <Text className="text-xs font-black uppercase text-gray-500">Invite Code</Text>
              <View className="mt-2 flex-row items-center gap-2">
                <View className="flex-1 rounded-xl px-3 py-2" style={{ backgroundColor: THEME.primarySoft }}>
                  <Text className="text-lg font-black tracking-widest" style={{ color: THEME.primary }}>
                    {group.inviteCode}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={copyInviteCode}
                  className="h-10 w-10 items-center justify-center rounded-xl border bg-white"
                  style={{ borderColor: THEME.border }}
                >
                  <Copy size={16} color="#1F2937" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={regenerateCode}
                  disabled={isRegenerating}
                  className="h-10 w-10 items-center justify-center rounded-xl border bg-white"
                  style={{ borderColor: THEME.border }}
                >
                  {isRegenerating ? (
                    <ActivityIndicator size="small" color="#1F2937" />
                  ) : (
                    <RefreshCw size={16} color="#1F2937" />
                  )}
                </TouchableOpacity>
              </View>
              <Text className="mt-2 text-xs leading-4 text-gray-500">
                Share this code so people can join. Regenerating invalidates the old code.
              </Text>
            </View>
          ) : null}

          <View className="mt-4 rounded-2xl border bg-white p-4" style={{ borderColor: THEME.border }}>
            <View className="flex-row items-center gap-2">
              <Users size={16} color={THEME.muted} />
              <Text className="text-xs font-black uppercase text-gray-500">
                Members ({members.length})
              </Text>
            </View>
            <View className="mt-3 gap-2">
              {members.map((member) => (
                <View key={member.userId} className="flex-row items-center justify-between gap-2">
                  <View className="min-w-0 flex-1 flex-row items-center gap-2">
                    {member.isLeader ? <Crown size={14} color={THEME.primary} /> : null}
                    <Text className="flex-1 text-sm font-semibold text-gray-900" numberOfLines={1}>
                      {member.name}
                      {member.userId === user?.id ? ' (you)' : ''}
                    </Text>
                  </View>
                  {group.isLeader && !member.isLeader ? (
                    <TouchableOpacity
                      onPress={() => makeLeader(member.userId, member.name)}
                      disabled={transferringUserId !== null}
                      className="rounded-lg border px-2 py-1"
                      style={{ borderColor: THEME.border }}
                    >
                      {transferringUserId === member.userId ? (
                        <ActivityIndicator size="small" color={THEME.primary} />
                      ) : (
                        <Text className="text-xs font-black" style={{ color: THEME.primary }}>
                          Make leader
                        </Text>
                      )}
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </View>
          </View>

          <View className="mt-4 rounded-2xl border bg-white p-4" style={{ borderColor: THEME.border }}>
            <Text className="text-xs font-black uppercase text-gray-500">Discussion</Text>
            <View className="mt-3 gap-3">
              {comments.length === 0 ? (
                <Text className="text-sm leading-5 text-gray-500">No messages yet. Say hello.</Text>
              ) : (
                comments.map((comment) => (
                  <View key={comment.id} className="rounded-xl bg-gray-50 px-3 py-2">
                    <View className="flex-row items-center justify-between gap-2">
                      <Text className="text-xs font-black text-gray-900">{comment.author}</Text>
                      <Text className="text-xs text-gray-400">{formatTime(comment.createdAt)}</Text>
                    </View>
                    <Text className="mt-1 text-sm leading-5 text-gray-700">{comment.content}</Text>
                  </View>
                ))
              )}
            </View>

            <View className="mt-3 flex-row items-end gap-2">
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Write something..."
                placeholderTextColor={THEME.muted}
                multiline
                className="min-h-11 flex-1 rounded-xl border bg-gray-50 px-3 py-2 text-sm text-gray-900"
                style={{ borderColor: THEME.border, maxHeight: 96, textAlignVertical: 'top' }}
              />
              <TouchableOpacity
                onPress={() => void postComment()}
                disabled={isPosting || !draft.trim()}
                className="h-11 w-11 items-center justify-center rounded-xl"
                style={{ backgroundColor: THEME.primary, opacity: isPosting || !draft.trim() ? 0.6 : 1 }}
                activeOpacity={0.82}
              >
                {isPosting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Send size={16} color="#FFFFFF" />}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
