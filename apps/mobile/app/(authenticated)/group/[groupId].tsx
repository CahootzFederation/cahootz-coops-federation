import type {
  CircleNotificationLevel,
  PrivateGroupDetail,
  PrivateGroupMember,
} from '@/lib/api';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { IconAvatar } from '@/components/icon-avatar';
import { EmojiColorPicker } from '@/components/emoji-color-picker';
import {
  ArrowLeft,
  Bell,
  Copy,
  Crown,
  LogOut,
  MessageCircle,
  Pencil,
  RefreshCw,
  Settings2,
  Users,
} from 'lucide-react-native';

const NOTIFICATION_LEVEL_OPTIONS: Array<{
  level: CircleNotificationLevel;
  label: string;
  description: string;
}> = [
  {
    level: 'ALL',
    label: 'All activity',
    description: 'Every new post and reply in this circle.',
  },
  {
    level: 'MENTIONS',
    label: 'Only @mentions',
    description: 'When someone mentions you or replies to your post.',
  },
  {
    level: 'NONE',
    label: 'Nothing',
    description: 'No phone notifications. Mentions still show in Alerts.',
  },
];

const THEME = {
  paper: '#F8FAFC',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
  muted: '#64748B',
};

export default function GroupDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { user, isLoading, isAuthenticated, sessionToken } = useAuth();

  const [group, setGroup] = React.useState<PrivateGroupDetail | null>(null);
  const [members, setMembers] = React.useState<PrivateGroupMember[]>([]);
  const [isLoadingGroup, setIsLoadingGroup] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = React.useState(false);
  const [transferringUserId, setTransferringUserId] = React.useState<
    string | null
  >(null);
  const [isLeaving, setIsLeaving] = React.useState(false);
  const [isUpdatingPrivacy, setIsUpdatingPrivacy] = React.useState(false);
  const [iconPickerOpen, setIconPickerOpen] = React.useState(false);
  const [isSavingIcon, setIsSavingIcon] = React.useState(false);
  const [savingNotificationLevel, setSavingNotificationLevel] =
    React.useState<CircleNotificationLevel | null>(null);

  React.useEffect(() => {
    if (isLoading || (isAuthenticated && sessionToken)) return;

    router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
  }, [isAuthenticated, isLoading, sessionToken]);

  const load = React.useCallback(() => {
    if (!sessionToken || !groupId) return;

    setIsLoadingGroup(true);
    setError(null);
    api
      .getGroupDetail(groupId, sessionToken)
      .then((detail) => {
        setGroup(detail.group);
        setMembers(detail.members);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load group.'),
      )
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
      const { inviteCode } = await api.regenerateGroupInviteCode(
        groupId,
        sessionToken,
      );
      setGroup((current) => (current ? { ...current, inviteCode } : current));
    } catch (err) {
      Alert.alert(
        'Could not regenerate code',
        err instanceof Error ? err.message : 'Try again.',
      );
    } finally {
      setIsRegenerating(false);
    }
  };

  const makeLeader = (newLeaderUserId: string, name: string) => {
    if (!sessionToken || !groupId) return;

    Alert.alert(
      'Transfer leadership',
      `Make ${name} the leader of this circle?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Transfer',
          style: 'destructive',
          onPress: async () => {
            setTransferringUserId(newLeaderUserId);
            try {
              await api.transferGroupLeadership(
                groupId,
                newLeaderUserId,
                sessionToken,
              );
              load();
            } catch (err) {
              Alert.alert(
                'Could not transfer leadership',
                err instanceof Error ? err.message : 'Try again.',
              );
            } finally {
              setTransferringUserId(null);
            }
          },
        },
      ],
    );
  };

  const leaveGroup = () => {
    if (!sessionToken || !groupId) return;

    Alert.alert('Leave circle', 'Are you sure you want to leave this circle?', [
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
            Alert.alert(
              'Could not leave circle',
              err instanceof Error ? err.message : 'Try again.',
            );
            setIsLeaving(false);
          }
        },
      },
    ]);
  };

  const saveIcon = async (emoji: string | null, color: string | null) => {
    if (!group || !sessionToken) return;
    setIsSavingIcon(true);
    try {
      const result = await api.updateGroupIcon(
        { groupId: group.id, iconEmoji: emoji, iconColor: color },
        sessionToken,
      );
      setGroup((current) =>
        current
          ? { ...current, iconEmoji: result.iconEmoji, iconColor: result.iconColor }
          : current,
      );
    } catch (err) {
      Alert.alert(
        'Could not update icon',
        err instanceof Error ? err.message : 'Try again.',
      );
    } finally {
      setIsSavingIcon(false);
    }
  };

  const changeNotificationLevel = async (level: CircleNotificationLevel) => {
    if (!group || !sessionToken || savingNotificationLevel) return;
    if (group.myNotificationLevel === level) return;
    const previous = group.myNotificationLevel;
    setSavingNotificationLevel(level);
    setGroup((current) =>
      current ? { ...current, myNotificationLevel: level } : current,
    );
    try {
      await api.updateCircleNotificationLevel(group.id, level, sessionToken);
    } catch (err) {
      setGroup((current) =>
        current ? { ...current, myNotificationLevel: previous } : current,
      );
      Alert.alert(
        'Could not update notifications',
        err instanceof Error ? err.message : 'Try again.',
      );
    } finally {
      setSavingNotificationLevel(null);
    }
  };

  const changePrivacy = (privacy: 'public' | 'private') => {
    if (!group || !sessionToken || !group.isLeader || isUpdatingPrivacy) return;
    if (group.privacy === privacy) return;
    const makePublic = privacy === 'public';
    Alert.alert(
      makePublic ? 'Make this circle public?' : 'Make this circle private?',
      makePublic
        ? 'All existing posts and replies will become visible to members of this common. Only circle members can post or reply.'
        : 'Only current circle members will be able to see existing and future posts. Current members will stay in the circle.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: makePublic ? 'Make public' : 'Make private',
          onPress: async () => {
            setIsUpdatingPrivacy(true);
            try {
              const result = await api.updateCirclePrivacy(
                group.id,
                privacy,
                makePublic,
                sessionToken,
              );
              setGroup((current) => current ? { ...current, privacy: result.privacy } : current);
            } catch (err) {
              Alert.alert('Could not update privacy', err instanceof Error ? err.message : 'Try again.');
            } finally {
              setIsUpdatingPrivacy(false);
            }
          },
        },
      ],
    );
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
        <TouchableOpacity
          onPress={() => router.back()}
          className="mt-4 flex-row items-center gap-2"
        >
          <ArrowLeft size={18} color="#1F2937" />
          <Text className="text-sm font-bold text-gray-700">Back</Text>
        </TouchableOpacity>
        <View className="flex-1 items-center justify-center">
          <Text className="text-base font-black text-gray-900">
            {error || 'Group not found'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: THEME.paper }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View
          className="border-b bg-white px-3 pb-2 pt-3"
          style={{ borderColor: THEME.border }}
        >
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
              <TouchableOpacity
                onPress={() => router.push(`/commons/${group.coopId}` as any)}
                activeOpacity={0.7}
              >
                <Text
                  className="text-[10px] font-black uppercase"
                  style={{ color: THEME.primary }}
                  numberOfLines={1}
                >
                  {group.coopName} · {group.privacy.replace('-', ' ')}
                </Text>
              </TouchableOpacity>
              <Text
                className="text-base font-black text-gray-950"
                numberOfLines={1}
              >
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
              {isLeaving ? (
                <ActivityIndicator size="small" color="#DC2626" />
              ) : (
                <LogOut size={16} color="#DC2626" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View className="px-5 py-4">
          {group.purpose ? (
            <View
              className="rounded-2xl border bg-white p-4"
              style={{ borderColor: THEME.border }}
            >
              <Text className="text-sm leading-5 text-gray-700">
                {group.purpose}
              </Text>
            </View>
          ) : null}

          <View className="mt-4 rounded-2xl border bg-white p-4" style={{ borderColor: THEME.border }}>
            <View className="flex-row items-center gap-2">
              <Settings2 size={16} color={THEME.muted} />
              <Text className="text-xs font-black uppercase text-gray-500">Circle settings</Text>
            </View>

            <Text className="mt-3 text-sm font-black text-gray-950">Icon</Text>
            {group.isLeader ? (
              <TouchableOpacity
                onPress={() => setIconPickerOpen(true)}
                disabled={isSavingIcon}
                className="mt-2 flex-row items-center gap-3"
              >
                <IconAvatar
                  emoji={group.iconEmoji}
                  color={group.iconColor}
                  fallbackText={group.name}
                  size={44}
                />
                <View className="flex-row items-center gap-1.5 rounded-full border bg-gray-50 px-3 py-1.5" style={{ borderColor: THEME.border }}>
                  {isSavingIcon ? (
                    <ActivityIndicator size="small" color={THEME.primary} />
                  ) : (
                    <Pencil size={13} color={THEME.muted} />
                  )}
                  <Text className="text-xs font-bold text-gray-700">Change icon</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View className="mt-2 flex-row items-center gap-3">
                <IconAvatar
                  emoji={group.iconEmoji}
                  color={group.iconColor}
                  fallbackText={group.name}
                  size={44}
                />
                <Text className="text-xs font-semibold text-gray-500">Only the circle leader can change this.</Text>
              </View>
            )}

            <Text className="mt-4 text-sm font-black text-gray-950">Privacy</Text>
            <Text className="mt-1 text-xs leading-5 text-gray-600">
              {group.privacy === 'public'
                ? 'Members of this common can discover and read this circle. They must join before posting.'
                : 'Only circle members can find, read, and post here.'}
            </Text>
            {group.isLeader ? (
              <View className="mt-3 flex-row gap-2">
                <TouchableOpacity
                  onPress={() => changePrivacy('public')}
                  disabled={isUpdatingPrivacy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: group.privacy === 'public' }}
                  className="flex-1 items-center rounded-xl border px-3 py-3"
                  style={{ borderColor: group.privacy === 'public' ? THEME.primary : THEME.border, backgroundColor: group.privacy === 'public' ? THEME.primarySoft : '#FFFFFF' }}
                >
                  <Text className="text-xs font-black text-gray-900">Public</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => changePrivacy('private')}
                  disabled={isUpdatingPrivacy}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: group.privacy !== 'public' }}
                  className="flex-1 items-center rounded-xl border px-3 py-3"
                  style={{ borderColor: group.privacy !== 'public' ? THEME.primary : THEME.border, backgroundColor: group.privacy !== 'public' ? THEME.primarySoft : '#FFFFFF' }}
                >
                  <Text className="text-xs font-black text-gray-900">Private</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text className="mt-3 text-xs font-semibold text-gray-500">Only the circle leader can change this setting.</Text>
            )}
            {isUpdatingPrivacy ? <ActivityIndicator className="mt-3" size="small" color={THEME.primary} /> : null}
          </View>

          <View
            className="mt-4 rounded-2xl border bg-white p-4"
            style={{ borderColor: THEME.border }}
            accessibilityRole="radiogroup"
            accessibilityLabel="Circle notifications"
          >
            <View className="flex-row items-center gap-2">
              <Bell size={16} color={THEME.muted} />
              <Text className="text-xs font-black uppercase text-gray-500">
                Notifications
              </Text>
            </View>
            <View className="mt-3 gap-2">
              {NOTIFICATION_LEVEL_OPTIONS.map((option) => {
                const selected = group.myNotificationLevel === option.level;
                return (
                  <TouchableOpacity
                    key={option.level}
                    onPress={() => changeNotificationLevel(option.level)}
                    disabled={savingNotificationLevel !== null}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    aria-checked={selected}
                    accessibilityLabel={option.label}
                    accessibilityHint={option.description}
                    className="flex-row items-center gap-3 rounded-xl border px-3 py-3"
                    style={{
                      borderColor: selected ? THEME.primary : THEME.border,
                      backgroundColor: selected ? THEME.primarySoft : '#FFFFFF',
                    }}
                  >
                    <View
                      className="h-4 w-4 items-center justify-center rounded-full border-2"
                      style={{
                        borderColor: selected ? THEME.primary : '#CBD5E1',
                      }}
                    >
                      {selected ? (
                        <View
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: THEME.primary }}
                        />
                      ) : null}
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-black text-gray-900">
                        {option.label}
                      </Text>
                      <Text className="mt-0.5 text-xs leading-4 text-gray-600">
                        {option.description}
                      </Text>
                    </View>
                    {savingNotificationLevel === option.level ? (
                      <ActivityIndicator size="small" color={THEME.primary} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {group.isLeader && group.inviteCode && group.privacy !== 'public' ? (
            <View
              className="mt-4 rounded-2xl border bg-white p-4"
              style={{ borderColor: THEME.border }}
            >
              <Text className="text-xs font-black uppercase text-gray-500">
                Invite Code
              </Text>
              <View className="mt-2 flex-row items-center gap-2">
                <View
                  className="flex-1 rounded-xl px-3 py-2"
                  style={{ backgroundColor: THEME.primarySoft }}
                >
                  <Text
                    className="text-lg font-black tracking-widest"
                    style={{ color: THEME.primary }}
                  >
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
                Share this code so people can join. Regenerating invalidates the
                old code.
              </Text>
            </View>
          ) : null}

          <View
            className="mt-4 rounded-2xl border bg-white p-4"
            style={{ borderColor: THEME.border }}
          >
            <View className="flex-row items-center gap-2">
              <Users size={16} color={THEME.muted} />
              <Text className="text-xs font-black uppercase text-gray-500">
                Members ({members.length})
              </Text>
            </View>
            <View className="mt-3 gap-2">
              {members.map((member) => (
                <View
                  key={member.userId}
                  className="flex-row items-center justify-between gap-2"
                >
                  <View className="min-w-0 flex-1 flex-row items-center gap-2">
                    {member.isLeader ? (
                      <Crown size={14} color={THEME.primary} />
                    ) : null}
                    <Text
                      className="flex-1 text-sm font-semibold text-gray-900"
                      numberOfLines={1}
                    >
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
                        <Text
                          className="text-xs font-black"
                          style={{ color: THEME.primary }}
                        >
                          Make leader
                        </Text>
                      )}
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </View>
          </View>

          <TouchableOpacity
            onPress={() =>
              router.replace({
                pathname: '/[coopId]/posts',
                params: { coopId: group.coopId, circleId: group.id },
              } as any)
            }
            className="mt-4 flex-row items-center justify-center gap-2 rounded-2xl py-3"
            style={{ backgroundColor: THEME.primary }}
            activeOpacity={0.82}
          >
            <MessageCircle size={17} color="#FFFFFF" />
            <Text className="text-sm font-black text-white">
              Open circle feed
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <EmojiColorPicker
        visible={iconPickerOpen}
        title="Circle icon"
        fallbackText={group.name}
        initialEmoji={group.iconEmoji}
        initialColor={group.iconColor}
        onClose={() => setIconPickerOpen(false)}
        onSave={saveIcon}
      />
    </SafeAreaView>
  );
}
