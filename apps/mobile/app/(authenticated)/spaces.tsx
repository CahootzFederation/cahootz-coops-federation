import type { GroupCreateRequirements, PrivateGroupSummary } from '@/lib/api';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { IconAvatar } from '@/components/icon-avatar';
import { EmojiColorPicker } from '@/components/emoji-color-picker';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  KeyRound,
  Lock,
  MessageCircle,
  Pencil,
  Plus,
  Users,
} from 'lucide-react-native';

const SPACES_THEME = {
  paper: '#F8FAFC',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
  muted: '#64748B',
  ink: '#111827',
  inkSoft: '#1F2937',
  white: '#FFFFFF',
  quietIcon: '#94A3B8',
  lockIcon: '#475569',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export default function SpacesScreen() {
  const { coopId, coopName, mode } = useLocalSearchParams<{
    coopId?: string;
    coopName?: string;
    mode?: string;
  }>();
  const { isLoading, isAuthenticated, sessionToken } = useAuth();
  const [groups, setGroups] = React.useState<PrivateGroupSummary[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = React.useState(true);
  const [name, setName] = React.useState('');
  const [purpose, setPurpose] = React.useState('');
  const [privacy, setPrivacy] = React.useState<'public' | 'private'>('public');
  const [iconEmoji, setIconEmoji] = React.useState<string | null>(null);
  const [iconColor, setIconColor] = React.useState<string | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [joinCode, setJoinCode] = React.useState('');
  const [isJoining, setIsJoining] = React.useState(false);
  const [requirements, setRequirements] =
    React.useState<GroupCreateRequirements | null>(null);
  const [activeView, setActiveView] = React.useState<'circles' | 'create'>(
    mode === 'create' ? 'create' : 'circles',
  );

  React.useEffect(() => {
    setActiveView(mode === 'create' ? 'create' : 'circles');
  }, [mode]);

  React.useEffect(() => {
    if (activeView === 'create') setPrivacy('public');
  }, [activeView]);

  React.useEffect(() => {
    if (isLoading || (isAuthenticated && sessionToken)) return;

    router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
  }, [isAuthenticated, isLoading, sessionToken]);

  const loadGroups = React.useCallback(() => {
    if (!sessionToken) return;

    setIsLoadingGroups(true);
    (coopId ? api.listVisibleCircles(sessionToken, coopId) : api.listMyGroups(sessionToken))
      .then(({ groups: next }) => setGroups(next))
      .catch((error) => console.warn('Could not load groups:', error))
      .finally(() => setIsLoadingGroups(false));
  }, [sessionToken, coopId]);

  React.useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  React.useEffect(() => {
    if (!sessionToken) return;
    api
      .getGroupCreateRequirements(sessionToken, coopId)
      .then(setRequirements)
      .catch((error) =>
        console.warn('Could not load create requirements:', error),
      );
  }, [sessionToken, coopId]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(tabs)/wallet' as any);
  };

  const createSpace = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || isSaving || !sessionToken) return;

    if (requirements && !requirements.canCreate) {
      Alert.alert(
        'Not enough SC',
        `You need at least ${requirements.minScBalance} SC to create a circle (you have ${requirements.currentScBalance.toFixed(2)} SC).`,
      );
      return;
    }

    setIsSaving(true);
    try {
      const result = await api.createGroup(
        {
          name: trimmedName,
          purpose: purpose.trim() || undefined,
          privacy,
          coopId,
          iconEmoji: iconEmoji || undefined,
          iconColor: iconColor || undefined,
        },
        sessionToken,
      );
      setName('');
      setPurpose('');
      setPrivacy('public');
      setIconEmoji(null);
      setIconColor(null);
      loadGroups();
      router.replace({
        pathname: '/[coopId]/posts',
        params: { coopId: coopId || 'cahootz', circleId: result.group.id },
      } as any);
    } catch (error) {
      Alert.alert(
        'Could not create circle',
        error instanceof Error ? error.message : 'Try again.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const joinSpace = async () => {
    const trimmedCode = joinCode.trim();
    if (!trimmedCode || isJoining || !sessionToken) return;

    setIsJoining(true);
    try {
      const { groupId } = await api.joinGroupByCode(
        trimmedCode,
        sessionToken,
        coopId,
      );
      setJoinCode('');
      loadGroups();
      router.push({
        pathname: '/[coopId]/posts',
        params: { coopId: coopId || 'cahootz', circleId: groupId },
      } as any);
    } catch (error) {
      Alert.alert(
        'Could not join circle',
        error instanceof Error
          ? error.message
          : 'Check the code and try again.',
      );
    } finally {
      setIsJoining(false);
    }
  };

  if (isLoading || !isAuthenticated || !sessionToken) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <ActivityIndicator size="small" color={SPACES_THEME.primary} />
      </View>
    );
  }

  const creationBlocked = requirements ? !requirements.canCreate : false;
  const createDisabled = isSaving || !name.trim() || creationBlocked;

  return (
    <SafeAreaView
      className="flex-1"
      style={{ backgroundColor: SPACES_THEME.paper }}
    >
      <View
        className="border-b bg-white px-4 pb-3 pt-3"
        style={{ borderColor: SPACES_THEME.border }}
      >
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            onPress={handleBack}
            className="h-10 w-10 items-center justify-center rounded-full border bg-white"
            style={{ borderColor: SPACES_THEME.border }}
            accessibilityLabel="Go back"
          >
            <ArrowLeft
              size={18}
              color={SPACES_THEME.inkSoft}
              strokeWidth={2.6}
            />
          </TouchableOpacity>
          <View className="min-w-0 flex-1">
            <Text
              className="text-[10px] font-black uppercase tracking-wide text-gray-500"
              numberOfLines={1}
            >
              {coopName || 'Commons'}
            </Text>
            <Text
              className="text-lg font-black text-gray-950"
              numberOfLines={1}
            >
              {activeView === 'create' ? 'Create a circle' : 'Circles'}
            </Text>
          </View>
          <View
            className="h-10 w-10 items-center justify-center rounded-2xl"
            style={{ backgroundColor: SPACES_THEME.primary }}
          >
            <Users size={18} color={SPACES_THEME.white} />
          </View>
        </View>

        <View className="mt-3 flex-row rounded-2xl bg-gray-100 p-1">
          <TouchableOpacity
            onPress={() => setActiveView('circles')}
            className="flex-1 items-center rounded-xl py-2.5"
            style={
              activeView === 'circles'
                ? { backgroundColor: SPACES_THEME.white }
                : undefined
            }
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeView === 'circles' }}
          >
            <Text
              className="text-sm font-black"
              style={{
                color:
                  activeView === 'circles'
                    ? SPACES_THEME.ink
                    : SPACES_THEME.muted,
              }}
            >
              Your circles
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveView('create')}
            className="flex-1 items-center rounded-xl py-2.5"
            style={
              activeView === 'create'
                ? { backgroundColor: SPACES_THEME.white }
                : undefined
            }
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeView === 'create' }}
          >
            <Text
              className="text-sm font-black"
              style={{
                color:
                  activeView === 'create'
                    ? SPACES_THEME.primary
                    : SPACES_THEME.muted,
              }}
            >
              Create
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {activeView === 'circles' ? (
          <>
            <View className="flex-row items-start gap-3">
              <View
                className="h-10 w-10 items-center justify-center rounded-2xl"
                style={{ backgroundColor: SPACES_THEME.primarySoft }}
              >
                <MessageCircle size={18} color={SPACES_THEME.primary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xl font-black text-gray-950">
                  Conversations with a home
                </Text>
                <Text className="mt-1 text-sm font-semibold leading-5 text-gray-500">
                  Circles bring members together around shared interests,
                  projects, places, and community life.
                </Text>
              </View>
            </View>

            <View className="mt-6 flex-row items-center justify-between">
              <View>
                <Text className="text-base font-black text-gray-950">
                  {coopId ? 'Circles in this common' : 'Your circles'}
                </Text>
                <Text className="mt-0.5 text-xs font-semibold text-gray-500">
                  {groups.length} {groups.length === 1 ? 'circle' : 'circles'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setActiveView('create')}
                className="flex-row items-center gap-1.5 rounded-full px-3 py-2"
                style={{ backgroundColor: SPACES_THEME.primarySoft }}
                activeOpacity={0.8}
              >
                <Plus size={14} color={SPACES_THEME.primary} />
                <Text
                  className="text-xs font-black"
                  style={{ color: SPACES_THEME.primary }}
                >
                  New circle
                </Text>
              </TouchableOpacity>
            </View>

            <View className="mt-3 gap-3">
              {isLoadingGroups ? (
                <View className="items-center py-8">
                  <ActivityIndicator
                    size="small"
                    color={SPACES_THEME.primary}
                  />
                </View>
              ) : groups.length === 0 ? (
                <View className="rounded-3xl border border-dashed border-gray-300 bg-white p-5">
                  <Text className="text-base font-black text-gray-950">
                    No circles yet
                  </Text>
                  <Text className="mt-1 text-sm leading-5 text-gray-600">
                    Start one around a topic or project members will want to
                    return to.
                  </Text>
                  <TouchableOpacity
                    onPress={() => setActiveView('create')}
                    className="mt-4 flex-row items-center justify-center gap-2 rounded-2xl py-3"
                    style={{ backgroundColor: SPACES_THEME.primary }}
                    activeOpacity={0.82}
                  >
                    <Plus size={16} color={SPACES_THEME.white} />
                    <Text className="text-sm font-black text-white">
                      Create your first circle
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                groups.map((group) => (
                  <TouchableOpacity
                    key={group.id}
                    onPress={() =>
                      router.push({
                        pathname: '/[coopId]/posts',
                        params: {
                          coopId: coopId || 'cahootz',
                          circleId: group.id,
                        },
                      } as any)
                    }
                    activeOpacity={0.8}
                    className="rounded-3xl border bg-white p-4"
                    style={{ borderColor: SPACES_THEME.border }}
                  >
                    <View className="flex-row items-start gap-3">
                      <View
                        className="h-11 w-11 items-center justify-center rounded-2xl"
                        style={{ backgroundColor: SPACES_THEME.primarySoft }}
                      >
                        {group.privacy === 'public' ? (
                          <Users size={18} color={SPACES_THEME.primary} />
                        ) : (
                          <Lock size={18} color={SPACES_THEME.primary} />
                        )}
                      </View>
                      <View className="min-w-0 flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text
                            className="min-w-0 flex-1 text-base font-black text-gray-950"
                            numberOfLines={1}
                          >
                            {group.name}
                          </Text>
                          <ChevronRight
                            size={17}
                            color={SPACES_THEME.quietIcon}
                          />
                        </View>
                        <Text
                          className="mt-1 text-sm leading-5 text-gray-600"
                          numberOfLines={2}
                        >
                          {group.purpose || 'A circle for focused conversation'}
                        </Text>
                        <View className="mt-2 flex-row flex-wrap items-center gap-2">
                          <Text className="text-[10px] font-black uppercase text-gray-400">
                            {group.memberCount}{' '}
                            {group.memberCount === 1 ? 'member' : 'members'}
                          </Text>
                          {group.isLeader ? (
                            <Text
                              className="text-[10px] font-black uppercase"
                              style={{ color: SPACES_THEME.primary }}
                            >
                              Leader
                            </Text>
                          ) : null}
                          <Text className="text-[10px] font-black uppercase text-gray-400">
                            {group.privacy === 'public'
                              ? 'Public'
                              : group.privacy === 'private'
                                ? 'Private'
                                : 'Invite-only'}
                          </Text>
                          <Text className="text-[10px] font-semibold text-gray-400">
                            Updated {formatDate(group.createdAt)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </View>

            <View
              className="mt-6 rounded-3xl border bg-white p-4"
              style={{ borderColor: SPACES_THEME.border }}
            >
              <View className="flex-row items-center gap-2">
                <KeyRound size={16} color={SPACES_THEME.primary} />
                <Text className="text-sm font-black text-gray-950">
                  Join with an invite code
                </Text>
              </View>
              <Text className="mt-1 text-xs leading-5 text-gray-500">
                Enter a code shared by a circle member.
              </Text>
              <View className="mt-3 flex-row items-center gap-2">
                <TextInput
                  value={joinCode}
                  onChangeText={(text) => setJoinCode(text.toUpperCase())}
                  placeholder="Invite code"
                  autoCapitalize="characters"
                  placeholderTextColor={SPACES_THEME.muted}
                  className="min-h-12 flex-1 rounded-2xl border bg-gray-50 px-3 text-sm text-gray-900"
                  style={{ borderColor: SPACES_THEME.border }}
                />
                <TouchableOpacity
                  onPress={() => void joinSpace()}
                  disabled={isJoining || !joinCode.trim()}
                  className="min-h-12 items-center justify-center rounded-2xl px-5"
                  style={{
                    backgroundColor: SPACES_THEME.primary,
                    opacity: isJoining || !joinCode.trim() ? 0.55 : 1,
                  }}
                  activeOpacity={0.82}
                >
                  {isJoining ? (
                    <ActivityIndicator
                      size="small"
                      color={SPACES_THEME.white}
                    />
                  ) : (
                    <Text className="text-sm font-black text-white">Join</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : (
          <>
            <View className="flex-row items-start gap-3">
              <View
                className="h-10 w-10 items-center justify-center rounded-2xl"
                style={{ backgroundColor: SPACES_THEME.primarySoft }}
              >
                <Plus size={18} color={SPACES_THEME.primary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xl font-black text-gray-950">
                  Give the conversation a clear home
                </Text>
                <Text className="mt-1 text-sm font-semibold leading-5 text-gray-500">
                  Choose a specific name and purpose so members immediately
                  understand why this circle exists.
                </Text>
              </View>
            </View>

            <View
              className="mt-6 rounded-3xl border bg-white p-5"
              style={{ borderColor: SPACES_THEME.border }}
            >
              <Text className="text-sm font-black text-gray-950">Icon</Text>
              <Text className="mt-1 text-xs leading-5 text-gray-500">
                Pick an emoji and color, or leave it to use the circle&apos;s
                initial.
              </Text>
              <TouchableOpacity
                onPress={() => setIconPickerOpen(true)}
                className="mt-3 flex-row items-center gap-3"
              >
                <IconAvatar
                  emoji={iconEmoji}
                  color={iconColor}
                  fallbackText={name || 'C'}
                  size={48}
                />
                <View className="flex-row items-center gap-1.5 rounded-full border bg-gray-50 px-3 py-1.5" style={{ borderColor: SPACES_THEME.border }}>
                  <Pencil size={13} color={SPACES_THEME.muted} />
                  <Text className="text-xs font-bold text-gray-700">
                    Choose icon
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            <View
              className="mt-4 rounded-3xl border bg-white p-5"
              style={{ borderColor: SPACES_THEME.border }}
            >
              <Text className="text-sm font-black text-gray-950">
                Circle name
              </Text>
              <Text className="mt-1 text-xs leading-5 text-gray-500">
                Name the topic, group, project, or place—not the people in it.
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Example: South LA Gardeners"
                placeholderTextColor={SPACES_THEME.muted}
                maxLength={120}
                autoFocus={mode === 'create'}
                className="mt-3 min-h-12 rounded-2xl border bg-gray-50 px-3 text-sm text-gray-900"
                style={{ borderColor: SPACES_THEME.border }}
              />
              <Text className="mt-2 text-right text-[10px] font-semibold text-gray-400">
                {name.length}/120
              </Text>

              <Text className="mt-5 text-sm font-black text-gray-950">
                Purpose
              </Text>
              <Text className="mt-1 text-xs leading-5 text-gray-500">
                Explain what members will talk about or build together.
              </Text>
              <TextInput
                value={purpose}
                onChangeText={setPurpose}
                placeholder="What brings this circle together?"
                placeholderTextColor={SPACES_THEME.muted}
                maxLength={2000}
                multiline
                className="mt-3 min-h-28 rounded-2xl border bg-gray-50 px-3 py-3 text-sm text-gray-900"
                style={{
                  borderColor: SPACES_THEME.border,
                  textAlignVertical: 'top',
                }}
              />
            </View>

            <View
              className="mt-4 rounded-3xl border bg-white p-4"
              style={{ borderColor: SPACES_THEME.border }}
            >
              <Text className="mb-3 text-sm font-black text-gray-950">
                Who can see this circle?
              </Text>
              <TouchableOpacity
                onPress={() => setPrivacy('public')}
                accessibilityRole="radio"
                accessibilityState={{ selected: privacy === 'public' }}
                className="flex-row items-start gap-3 rounded-2xl p-3"
                style={{
                  backgroundColor:
                    privacy === 'public' ? SPACES_THEME.primarySoft : '#F9FAFB',
                }}
              >
                <Users size={17} color={SPACES_THEME.primary} />
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-black text-gray-950">
                    Public to this common
                  </Text>
                  <Text className="mt-1 text-xs leading-5 text-gray-500">
                    Members can discover, read, and post in this circle.
                  </Text>
                </View>
                {privacy === 'public' ? (
                  <Check size={17} color={SPACES_THEME.primary} />
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setPrivacy('private')}
                accessibilityRole="radio"
                accessibilityState={{ selected: privacy === 'private' }}
                className="mt-2 flex-row items-start gap-3 rounded-2xl p-3"
                style={{
                  backgroundColor:
                    privacy === 'private' ? SPACES_THEME.primarySoft : '#F9FAFB',
                }}
              >
                <Lock size={17} color={SPACES_THEME.lockIcon} />
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-black text-gray-950">Private</Text>
                  <Text className="mt-1 text-xs leading-5 text-gray-500">
                    Only you and people you invite can find, read, and post in this circle.
                  </Text>
                </View>
                {privacy === 'private' ? (
                  <Check size={17} color={SPACES_THEME.primary} />
                ) : null}
              </TouchableOpacity>
            </View>

            {requirements && requirements.minScBalance > 0 ? (
              <View
                className="mt-4 rounded-2xl px-4 py-3"
                style={{
                  backgroundColor: requirements.canCreate
                    ? SPACES_THEME.primarySoft
                    : SPACES_THEME.dangerSoft,
                }}
              >
                <Text
                  className="text-xs font-bold"
                  style={{
                    color: requirements.canCreate
                      ? SPACES_THEME.primary
                      : SPACES_THEME.danger,
                  }}
                >
                  {requirements.canCreate
                    ? `You meet the ${requirements.minScBalance} SC requirement.`
                    : `Creating a circle requires ${requirements.minScBalance} SC. Your balance is ${requirements.currentScBalance.toFixed(2)} SC.`}
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              onPress={() => void createSpace()}
              disabled={createDisabled}
              className="mt-6 flex-row items-center justify-center gap-2 rounded-2xl py-4"
              style={{
                backgroundColor: SPACES_THEME.primary,
                opacity: createDisabled ? 0.55 : 1,
              }}
              activeOpacity={0.82}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={SPACES_THEME.white} />
              ) : (
                <Plus size={17} color={SPACES_THEME.white} />
              )}
              <Text className="text-sm font-black text-white">
                Create circle
              </Text>
            </TouchableOpacity>
            <Text className="mt-3 text-center text-xs leading-5 text-gray-500">
              {privacy === 'public'
                ? 'Your circle will appear to members of this common.'
                : 'You will become the circle leader and can invite members next.'}
            </Text>
          </>
        )}
      </ScrollView>

      <EmojiColorPicker
        visible={iconPickerOpen}
        title="Circle icon"
        fallbackText={name || 'C'}
        initialEmoji={iconEmoji}
        initialColor={iconColor}
        onClose={() => setIconPickerOpen(false)}
        onSave={(emoji, color) => {
          setIconEmoji(emoji);
          setIconColor(color);
        }}
      />
    </SafeAreaView>
  );
}
