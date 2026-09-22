import type {
  ApplicationQuestion,
  CommonsAccessStatus,
  CommonsDirectoryItem,
  CoopConfigDetail,
  PrivateGroupSummary,
  ProposalSummary,
} from '@/lib/api';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Compass,
  FileText,
  Gavel,
  Lock,
  MessageCircle,
  Send,
  Target,
  Users,
  Vote,
} from 'lucide-react-native';

const THEME = {
  paper: '#F6F7F8',
  ink: '#111827',
  muted: '#6B7280',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  primaryBorder: '#FED7AA',
  greenSoft: '#ECFDF5',
  green: '#047857',
  blueSoft: '#EFF6FF',
  blue: '#1D4ED8',
  redSoft: '#FEF2F2',
  red: '#B91C1C',
  border: '#E5E7EB',
};

const DEFAULT_CONFIG: CoopConfigDetail = {
  coopId: 'cahootz',
  name: 'Cahootz Commons',
  slug: 'Cahootz',
  description:
    'A social commons for conversation, resources, and coordinated action.',
  displayMission:
    'Members turn useful conversations into proposals, shared resources, and coordinated action.',
  charterText: 'The commons charter has not been published yet.',
  missionGoals: [],
  proposalCategories: [],
  applicationQuestions: [],
  quorumPercent: 15,
  approvalThresholdPercent: 51,
  votingWindowDays: 7,
  aiAutoApproveThresholdUSD: 500,
  councilVoteThresholdUSD: 5000,
};

type ActivityStats = {
  activeMembers: number;
  discussionsThisMonth: number;
  openVotes: number;
};

type MembersPreview = {
  totalCount: number;
  members: { id: string; name: string; handle: string }[];
};

type InfoTab = 'overview' | 'community' | 'governance';

const TABS: { key: InfoTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'community', label: 'Community' },
  { key: 'governance', label: 'Governance' },
];

function formatMoney(value?: number, currency = 'USD') {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'Not connected';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0%';
  return `${Math.round(value)}%`;
}

function shortAddress(address?: string) {
  if (!address) return 'Not configured';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function statusLabel(status: string) {
  return status.toLowerCase().replace(/_/g, ' ');
}

function proposalBudget(proposal: ProposalSummary) {
  return formatMoney(
    proposal.budget?.amount,
    proposal.budget?.currency || 'USD',
  );
}

function accessCopy(status: CommonsAccessStatus) {
  if (status === 'ACTIVE')
    return { label: 'Member', bg: THEME.greenSoft, fg: THEME.green };
  if (status === 'PENDING')
    return { label: 'Application pending', bg: THEME.blueSoft, fg: THEME.blue };
  if (status === 'REJECTED')
    return { label: 'Application closed', bg: THEME.redSoft, fg: THEME.red };
  return { label: 'Locked', bg: THEME.primarySoft, fg: THEME.primary };
}

function isEmailQuestion(question: ApplicationQuestion) {
  const id = question.id.toLowerCase();
  const label = question.label.toLowerCase();
  return (
    question.type === 'email' ||
    id === 'email' ||
    id.includes('email') ||
    label.includes('email')
  );
}

function isPhoneQuestion(question: ApplicationQuestion) {
  const id = question.id.toLowerCase();
  const label = question.label.toLowerCase();
  return (
    question.type === 'phone' ||
    id === 'phone' ||
    id.includes('phone') ||
    label.includes('phone')
  );
}

export default function CommonsDetailScreen() {
  const params = useLocalSearchParams<{ coopId?: string }>();
  const coopId = params.coopId || 'cahootz';
  const { sessionToken, user } = useAuth();
  const [config, setConfig] = useState<CoopConfigDetail | null>(null);
  const [directoryItem, setDirectoryItem] =
    useState<CommonsDirectoryItem | null>(null);
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [activityStats, setActivityStats] = useState<ActivityStats | null>(
    null,
  );
  const [membersPreview, setMembersPreview] = useState<MembersPreview | null>(
    null,
  );
  const [circles, setCircles] = useState<PrivateGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<InfoTab>('overview');
  const [charterExpanded, setCharterExpanded] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyName, setApplyName] = useState(user?.name || '');
  const [applyPhone, setApplyPhone] = useState(user?.phone || '');
  const [applicationAnswers, setApplicationAnswers] = useState<
    Record<string, unknown>
  >({});
  const [applyError, setApplyError] = useState('');
  const [applySuccess, setApplySuccess] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [configResult, directoryResult] = await Promise.all([
          api.getCoopConfig(coopId),
          api.listCommonsDirectory(sessionToken),
        ]);
        const currentDirectoryItem =
          directoryResult.coops.find((item) => item.id === coopId) || null;
        const hasMemberAccess = currentDirectoryItem?.accessStatus === 'ACTIVE';
        if (!mounted) return;
        setConfig(configResult || { ...DEFAULT_CONFIG, coopId });
        setDirectoryItem(currentDirectoryItem);

        // Each of these backs one info-page tab. None of them should be
        // able to knock the whole page (or membership status determined
        // above) back to the signed-out view if one of them fails -
        // Promise.allSettled + per-call logging keeps them independent.
        const [proposalsResult, statsResult, membersResult, circlesResult] =
          hasMemberAccess
            ? await Promise.allSettled([
                api.listProposals(
                  { coopId, limit: 5, offset: 0 },
                  user?.walletAddress,
                ),
                api.getCommonsActivityStats(coopId, sessionToken),
                api.listCommonsMembers(coopId, sessionToken, 8),
                sessionToken
                  ? api.listVisibleCircles(sessionToken, coopId)
                  : Promise.resolve({ groups: [] }),
              ])
            : [];
        if (!mounted) return;

        if (proposalsResult?.status === 'fulfilled') {
          setProposals(proposalsResult.value?.proposals || []);
        } else if (proposalsResult) {
          console.error('Failed to load proposals:', proposalsResult.reason);
        }
        if (statsResult?.status === 'fulfilled') {
          setActivityStats(statsResult.value);
        } else if (statsResult) {
          console.error('Failed to load activity stats:', statsResult.reason);
        }
        if (membersResult?.status === 'fulfilled') {
          setMembersPreview(membersResult.value);
        } else if (membersResult) {
          console.error('Failed to load members preview:', membersResult.reason);
        }
        if (circlesResult?.status === 'fulfilled') {
          setCircles(circlesResult.value?.groups || []);
        } else if (circlesResult) {
          console.error('Failed to load circles:', circlesResult.reason);
        }
      } catch (err) {
        console.error('Failed to load commons detail:', err);
        if (!mounted) return;
        setConfig({ ...DEFAULT_CONFIG, coopId });
        setDirectoryItem(null);
        setProposals([]);
        setActivityStats(null);
        setMembersPreview(null);
        setCircles([]);
        setError(
          'Could not load the full commons page. Showing the starter view.',
        );
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [coopId, sessionToken, user?.walletAddress]);


  useEffect(() => {
    setApplyName(user?.name || '');
    setApplyPhone(user?.phone || '');
  }, [user?.name, user?.phone]);

  const activeConfig = config || { ...DEFAULT_CONFIG, coopId };
  const name = activeConfig.name || activeConfig.slug || activeConfig.coopId;
  const description =
    activeConfig.description ||
    activeConfig.displayMission ||
    DEFAULT_CONFIG.description;
  const accessStatus = directoryItem?.accessStatus || 'LOCKED';
  const accessTone = accessCopy(accessStatus);
  const isMember = accessStatus === 'ACTIVE';
  const canApply = accessStatus === 'LOCKED';
  const visibleApplicationQuestions = useMemo(
    () =>
      (activeConfig.applicationQuestions || []).filter(
        (question) => !isEmailQuestion(question),
      ),
    [activeConfig.applicationQuestions],
  );
  const phoneQuestion = useMemo(
    () =>
      visibleApplicationQuestions.find((question) => isPhoneQuestion(question)),
    [visibleApplicationQuestions],
  );
  const needsProfileName = !user?.name?.trim();
  const needsProfilePhone = !user?.phone?.trim() && !phoneQuestion;
  const canOpenApply = canApply && !!sessionToken && !!user;

  function handleAnswerChange(questionId: string, value: unknown) {
    setApplicationAnswers((current) => ({
      ...current,
      [questionId]: value,
    }));
  }

  async function handleApply() {
    if (!user || !sessionToken) {
      setApplyError('Sign in to apply to this commons.');
      return;
    }

    const displayName = (user.name || applyName).trim();
    const phone = user.phone?.trim() || applyPhone.trim();
    const missingFields: string[] = [];

    if (!displayName) missingFields.push('Name');
    if (!phone && needsProfilePhone) missingFields.push('Phone');
    visibleApplicationQuestions.forEach((question) => {
      if (!question.required) return;
      const answer = applicationAnswers[question.id];
      if (!answer || (Array.isArray(answer) && answer.length === 0)) {
        missingFields.push(question.label);
      }
    });

    if (missingFields.length > 0) {
      setApplyError(`Please answer: ${missingFields.join(', ')}`);
      return;
    }

    setApplying(true);
    setApplyError('');
    try {
      const result = await api.applyToCommons(
        {
          coopId,
          displayName,
          phone,
          dynamicAnswers: {
            ...applicationAnswers,
            source: 'mobile_commons_detail',
          },
        },
        sessionToken,
      );

      setDirectoryItem((current) => ({
        id: current?.id || coopId,
        name: current?.name || name,
        shortName: current?.shortName || activeConfig.slug || name,
        description:
          current?.description ||
          description ||
          DEFAULT_CONFIG.description ||
          'A commons for shared conversation, resources, and coordinated action.',
        tagline: current?.tagline || activeConfig.tagline,
        mission: current?.mission || activeConfig.displayMission,
        eligibility: current?.eligibility || activeConfig.eligibility,
        iconEmoji: current?.iconEmoji ?? activeConfig.iconEmoji,
        iconColor: current?.iconColor ?? activeConfig.iconColor,
        accessStatus: 'PENDING',
        isMember: false,
        isLocked: true,
        canApply: false,
        applicationId: result?.applicationId || current?.applicationId || null,
        applicationStatus: 'SUBMITTED',
      }));
      setApplySuccess(true);
    } catch (err) {
      console.error('Failed to apply to commons:', err);
      setApplyError(
        err instanceof Error ? err.message : 'Could not submit application.',
      );
    } finally {
      setApplying(false);
    }
  }

  function renderApplicationQuestion(question: ApplicationQuestion) {
    const answer = applicationAnswers[question.id];

    if (question.type === 'radio' || question.type === 'select') {
      return (
        <View key={question.id}>
          <Text className="font-black text-gray-900">
            {question.label}
            {question.required ? ' *' : ''}
          </Text>
          {question.description ? (
            <Text className="mt-1 text-sm leading-5 text-gray-600">
              {question.description}
            </Text>
          ) : null}
          <View className="mt-2 gap-2">
            {question.options?.map((option) => {
              const selected = answer === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => handleAnswerChange(question.id, option.value)}
                  className="rounded-xl border px-3 py-3"
                  style={{
                    backgroundColor: selected ? THEME.primarySoft : '#FFFFFF',
                    borderColor: selected ? THEME.primary : THEME.border,
                  }}
                >
                  <Text
                    className="font-bold"
                    style={{ color: selected ? THEME.primary : THEME.ink }}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }

    if (question.type === 'multiselect') {
      const selectedValues = Array.isArray(answer) ? (answer as string[]) : [];
      return (
        <View key={question.id}>
          <Text className="font-black text-gray-900">
            {question.label}
            {question.required ? ' *' : ''}
          </Text>
          {question.description ? (
            <Text className="mt-1 text-sm leading-5 text-gray-600">
              {question.description}
            </Text>
          ) : null}
          <View className="mt-2 gap-2">
            {question.options?.map((option) => {
              const selected = selectedValues.includes(option.value);
              return (
                <TouchableOpacity
                  key={option.value}
                  onPress={() =>
                    handleAnswerChange(
                      question.id,
                      selected
                        ? selectedValues.filter(
                            (value) => value !== option.value,
                          )
                        : [...selectedValues, option.value],
                    )
                  }
                  className="flex-row items-center gap-3 rounded-xl border px-3 py-3"
                  style={{
                    backgroundColor: selected ? THEME.primarySoft : '#FFFFFF',
                    borderColor: selected ? THEME.primary : THEME.border,
                  }}
                >
                  <View
                    className="h-5 w-5 items-center justify-center rounded-md border"
                    style={{
                      backgroundColor: selected ? THEME.primary : '#FFFFFF',
                      borderColor: selected ? THEME.primary : THEME.border,
                    }}
                  >
                    {selected ? (
                      <CheckCircle2 size={13} color="#FFFFFF" />
                    ) : null}
                  </View>
                  <Text
                    className="min-w-0 flex-1 font-bold"
                    style={{ color: selected ? THEME.primary : THEME.ink }}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }

    const isLongText = question.type === 'textarea';
    return (
      <View key={question.id}>
        <Text className="font-black text-gray-900">
          {question.label}
          {question.required ? ' *' : ''}
        </Text>
        {question.description ? (
          <Text className="mt-1 text-sm leading-5 text-gray-600">
            {question.description}
          </Text>
        ) : null}
        <TextInput
          value={typeof answer === 'string' ? answer : ''}
          onChangeText={(text) => handleAnswerChange(question.id, text)}
          placeholder={question.placeholder || ''}
          placeholderTextColor={THEME.muted}
          keyboardType={question.type === 'phone' ? 'phone-pad' : 'default'}
          multiline={isLongText}
          textAlignVertical={isLongText ? 'top' : 'center'}
          className={`${isLongText ? 'min-h-24' : ''} mt-2 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900`}
        />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: THEME.paper }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View className="px-4 pb-4 pt-2">
          <View className="mb-4 flex-row items-center justify-between">
            <TouchableOpacity
              onPress={() => router.back()}
              className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={20} color={THEME.ink} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)' as any)}
              className="rounded-full border border-gray-200 bg-white px-4 py-2"
            >
              <Text className="text-sm font-bold text-gray-800">Home</Text>
            </TouchableOpacity>
          </View>

          <View className="rounded-2xl border border-gray-200 bg-white p-4">
            <View className="mb-4 flex-row items-start gap-3">
              {isMember ? (
                <IconAvatar
                  emoji={activeConfig.iconEmoji}
                  color={activeConfig.iconColor || THEME.primary}
                  fallbackText={name}
                  size={56}
                />
              ) : (
                <View
                  className="h-14 w-14 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: THEME.primary }}
                >
                  <Lock size={24} color="#FFFFFF" />
                </View>
              )}
              <View className="min-w-0 flex-1">
                <View className="mb-1 flex-row items-center gap-2">
                  <Text className="text-xs font-black uppercase text-gray-500">
                    Commons
                  </Text>
                  <View
                    className="rounded-full px-2 py-1"
                    style={{ backgroundColor: accessTone.bg }}
                  >
                    <Text
                      className="text-xs font-black"
                      style={{ color: accessTone.fg }}
                    >
                      {accessTone.label}
                    </Text>
                  </View>
                </View>
                <Text className="text-3xl font-black leading-9 text-gray-950">
                  {name}
                </Text>
                {activeConfig.tagline ? (
                  <Text
                    className="mt-1 text-sm font-bold"
                    style={{ color: THEME.primary }}
                  >
                    {activeConfig.tagline}
                  </Text>
                ) : null}
              </View>
            </View>
            <Text className="text-base leading-6 text-gray-700">
              {description}
            </Text>

            <View className="mt-4 flex-row gap-2">
              {isMember ? (
                <>
                  <TouchableOpacity
                    onPress={() => router.push(`/${coopId}/posts` as any)}
                    className="flex-1 flex-row items-center justify-center gap-2 rounded-xl px-4 py-3"
                    style={{ backgroundColor: THEME.primary }}
                  >
                    <MessageCircle size={17} color="white" />
                    <Text className="font-black text-white">Posts</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push(`/${coopId}/proposal` as any)}
                    className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3"
                  >
                    <Vote size={17} color={THEME.primary} />
                    <Text className="font-black text-gray-900">Proposal</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  onPress={() =>
                    canOpenApply ? setApplyOpen(true) : undefined
                  }
                  disabled={!canOpenApply}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-xl px-4 py-3"
                  style={{
                    backgroundColor: canOpenApply
                      ? THEME.primary
                      : THEME.border,
                  }}
                >
                  {canOpenApply ? (
                    <Send size={17} color="white" />
                  ) : (
                    <CheckCircle2 size={17} color={THEME.muted} />
                  )}
                  <Text
                    className={
                      canOpenApply
                        ? 'font-black text-white'
                        : 'font-black text-gray-500'
                    }
                  >
                    {canApply && !canOpenApply
                      ? 'Sign in to apply'
                      : canOpenApply
                        ? 'Apply to join'
                        : accessTone.label}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {error ? (
            <View className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
              <Text className="text-sm font-semibold text-orange-800">
                {error}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="px-4">
          {loading ? (
            <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-5">
              <ActivityIndicator color={THEME.primary} />
              <Text className="mt-3 text-center text-sm font-semibold text-gray-500">
                Loading commons...
              </Text>
            </View>
          ) : null}

          {!isMember ? (
            <View
              className="mb-3 rounded-2xl border p-4"
              style={{
                borderColor: THEME.primaryBorder,
                backgroundColor: THEME.primarySoft,
              }}
            >
              <View className="flex-row items-start gap-3">
                <Lock size={20} color={THEME.primary} />
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-black text-gray-950">
                    {accessStatus === 'PENDING'
                      ? 'Application pending'
                      : 'Membership required'}
                  </Text>
                  <Text className="mt-1 text-sm leading-5 text-gray-700">
                    {accessStatus === 'PENDING'
                      ? 'You applied to this commons. The full info page unlocks after approval.'
                      : 'Apply to join this commons. Overview, community, and governance details are only visible to approved members.'}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {isMember ? (
            <>
              <View className="mb-4 flex-row rounded-2xl border border-gray-200 bg-white p-1">
                {TABS.map((tab) => {
                  const selected = activeTab === tab.key;
                  return (
                    <TouchableOpacity
                      key={tab.key}
                      onPress={() => setActiveTab(tab.key)}
                      className="flex-1 items-center rounded-xl py-2.5"
                      style={{
                        backgroundColor: selected ? THEME.primary : 'transparent',
                      }}
                    >
                      <Text
                        className="text-sm font-black"
                        style={{ color: selected ? '#FFFFFF' : THEME.muted }}
                      >
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {activeTab === 'overview' ? (
                <OverviewTab
                  config={activeConfig}
                  stats={activityStats}
                  charterExpanded={charterExpanded}
                  onToggleCharter={() => setCharterExpanded((v) => !v)}
                  onBrowseResources={() =>
                    router.push({
                      pathname: '/(authenticated)/commons-resources',
                      params: { coopId },
                    })
                  }
                />
              ) : null}

              {activeTab === 'community' ? (
                <CommunityTab
                  membersPreview={membersPreview}
                  circles={circles}
                  onOpenCircle={(circle) =>
                    router.push(
                      `/${coopId}/posts?circleId=${circle.id}` as any,
                    )
                  }
                  onSeeAllCircles={() =>
                    router.push({
                      pathname: '/(authenticated)/spaces',
                      params: { coopId, coopName: name },
                    } as any)
                  }
                />
              ) : null}

              {activeTab === 'governance' ? (
                <GovernanceTab
                  config={activeConfig}
                  proposals={proposals}
                  onViewAllProposals={() =>
                    router.push(`/${coopId}/proposal` as any)
                  }
                  onOpenProposal={(id) =>
                    router.push(`/(tabs)/proposal-detail?id=${id}` as any)
                  }
                />
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={applyOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setApplyOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <View
            className="rounded-t-3xl bg-white px-4 pb-8 pt-5"
            style={{ maxHeight: '88%' }}
          >
            {applySuccess ? (
              <View className="items-center py-6">
                <View
                  className="mb-4 h-14 w-14 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: THEME.greenSoft }}
                >
                  <CheckCircle2 size={30} color={THEME.green} />
                </View>
                <Text className="text-center text-2xl font-black text-gray-950">
                  Application sent
                </Text>
                <Text className="mt-2 text-center text-sm leading-5 text-gray-600">
                  Your request to join {name} is pending. This commons unlocks
                  after approval.
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setApplyOpen(false);
                    setApplySuccess(false);
                  }}
                  className="mt-5 w-full rounded-xl px-4 py-3"
                  style={{ backgroundColor: THEME.primary }}
                >
                  <Text className="text-center font-black text-white">
                    Done
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View className="mb-4 flex-row items-start justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-xs font-black uppercase text-gray-500">
                      Apply to join
                    </Text>
                    <Text className="text-2xl font-black text-gray-950">
                      {name}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setApplyOpen(false)}
                    className="rounded-full bg-gray-100 px-3 py-2"
                  >
                    <Text className="font-black text-gray-700">Close</Text>
                  </TouchableOpacity>
                </View>

                <View
                  className="mb-4 rounded-xl p-3"
                  style={{ backgroundColor: THEME.primarySoft }}
                >
                  <Text
                    className="text-xs font-black uppercase"
                    style={{ color: THEME.primary }}
                  >
                    Applying as
                  </Text>
                  <Text className="mt-1 text-base font-black text-gray-950">
                    {user?.name || 'Your Cahootz account'}
                  </Text>
                  <Text className="text-sm font-semibold text-gray-600">
                    {user?.email}
                  </Text>
                </View>

                <View className="gap-3">
                  {needsProfileName ? (
                    <View>
                      <Text className="font-black text-gray-900">
                        Full name *
                      </Text>
                      <TextInput
                        value={applyName}
                        onChangeText={setApplyName}
                        placeholder="Full name"
                        placeholderTextColor={THEME.muted}
                        className="mt-2 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
                      />
                    </View>
                  ) : null}
                  {needsProfilePhone ? (
                    <View>
                      <Text className="font-black text-gray-900">Phone *</Text>
                      <TextInput
                        value={applyPhone}
                        onChangeText={setApplyPhone}
                        placeholder="Phone"
                        placeholderTextColor={THEME.muted}
                        keyboardType="phone-pad"
                        className="mt-2 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
                      />
                    </View>
                  ) : null}
                  {visibleApplicationQuestions.map((question) =>
                    renderApplicationQuestion(question),
                  )}
                  {visibleApplicationQuestions.length === 0 ? (
                    <View className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
                      <Text className="text-base font-black text-gray-900">
                        No extra questions
                      </Text>
                      <Text className="mt-1 text-sm leading-5 text-gray-600">
                        This commons is only asking for your Cahootz account
                        identity right now.
                      </Text>
                    </View>
                  ) : null}
                </View>

                {activeConfig.eligibility ? (
                  <View className="mt-3 rounded-xl bg-gray-50 p-3">
                    <Text className="text-xs font-black uppercase text-gray-500">
                      Basic rules
                    </Text>
                    <Text className="mt-1 text-sm leading-5 text-gray-700">
                      {activeConfig.eligibility}
                    </Text>
                  </View>
                ) : null}

                {applyError ? (
                  <View className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
                    <Text className="text-sm font-semibold text-orange-800">
                      {applyError}
                    </Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  onPress={handleApply}
                  disabled={applying}
                  className="mt-4 flex-row items-center justify-center gap-2 rounded-xl px-4 py-3"
                  style={{
                    backgroundColor: applying ? THEME.border : THEME.primary,
                  }}
                >
                  {applying ? (
                    <ActivityIndicator color={THEME.muted} />
                  ) : (
                    <Send size={17} color="white" />
                  )}
                  <Text
                    className={
                      applying
                        ? 'font-black text-gray-500'
                        : 'font-black text-white'
                    }
                  >
                    {applying ? 'Sending...' : 'Send application'}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function OverviewTab({
  config,
  stats,
  charterExpanded,
  onToggleCharter,
  onBrowseResources,
}: {
  config: CoopConfigDetail;
  stats: ActivityStats | null;
  charterExpanded: boolean;
  onToggleCharter: () => void;
  onBrowseResources: () => void;
}) {
  return (
    <>
      <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
        <Text className="text-lg font-black text-gray-950">About</Text>
        <Text className="mt-2 text-sm leading-6 text-gray-700">
          {config.description || config.displayMission}
        </Text>
        <TouchableOpacity onPress={onToggleCharter} className="mt-2">
          <Text className="text-sm font-black" style={{ color: THEME.primary }}>
            {charterExpanded ? 'Hide charter' : 'Read full charter →'}
          </Text>
        </TouchableOpacity>
        {charterExpanded ? (
          <View className="mt-3 rounded-xl bg-gray-50 p-3">
            <Text className="text-sm leading-6 text-gray-700">
              {config.charterText}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
        <View className="mb-1 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Target size={19} color={THEME.primary} />
            <Text className="text-lg font-black text-gray-950">
              What we&apos;re building toward
            </Text>
          </View>
          <Text className="text-xs font-black uppercase text-gray-400">
            Mission priority
          </Text>
        </View>
        {config.missionGoals.length > 0 ? (
          <View className="mt-2 gap-3">
            {config.missionGoals.map((goal) => {
              const percent = Math.round(goal.priorityWeight * 100);
              return (
                <View key={goal.key}>
                  <View className="mb-1.5 flex-row items-center justify-between gap-3">
                    <Text className="min-w-0 flex-1 font-bold text-gray-900">
                      {goal.label}
                    </Text>
                    <Text
                      className="text-xs font-black"
                      style={{ color: THEME.primary }}
                    >
                      {percent}%
                    </Text>
                  </View>
                  <View className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <View
                      className="h-2 rounded-full"
                      style={{ width: `${percent}%`, backgroundColor: THEME.primary }}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Text className="mt-2 text-sm leading-5 text-gray-600">
            No mission priorities have been published for this commons yet.
          </Text>
        )}
      </View>

      <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
        <Text className="mb-3 text-lg font-black text-gray-950">
          This month
        </Text>
        {stats ? (
          <View className="flex-row">
            <View className="flex-1 items-center">
              <Text className="text-2xl font-black text-gray-950">
                {stats.activeMembers}
              </Text>
              <Text className="mt-1 text-xs font-bold text-gray-500">
                active members
              </Text>
            </View>
            <View className="flex-1 items-center border-x border-gray-100">
              <Text className="text-2xl font-black text-gray-950">
                {stats.discussionsThisMonth}
              </Text>
              <Text className="mt-1 text-xs font-bold text-gray-500">
                discussions
              </Text>
            </View>
            <View className="flex-1 items-center">
              <Text className="text-2xl font-black text-gray-950">
                {stats.openVotes}
              </Text>
              <Text className="mt-1 text-xs font-bold text-gray-500">
                open votes
              </Text>
            </View>
          </View>
        ) : (
          <ActivityIndicator color={THEME.primary} />
        )}
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        onPress={onBrowseResources}
        className="mb-3 rounded-2xl border border-gray-200 bg-white p-4"
      >
        <Text className="text-lg font-black text-gray-950">
          Browse verified resources →
        </Text>
        <Text className="mt-1 text-sm text-gray-600">
          People, skills, spaces, tools, and useful information shared with
          this Commons.
        </Text>
      </TouchableOpacity>
    </>
  );
}

function CommunityTab({
  membersPreview,
  circles,
  onOpenCircle,
  onSeeAllCircles,
}: {
  membersPreview: MembersPreview | null;
  circles: PrivateGroupSummary[];
  onOpenCircle: (circle: PrivateGroupSummary) => void;
  onSeeAllCircles: () => void;
}) {
  return (
    <>
      <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
        <View className="mb-3 flex-row items-center gap-2">
          <Users size={19} color={THEME.primary} />
          <Text className="text-lg font-black text-gray-950">People</Text>
        </View>
        {membersPreview ? (
          <>
            <View className="flex-row">
              {membersPreview.members.map((member, index) => (
                <View
                  key={member.id}
                  style={{ marginLeft: index === 0 ? 0 : -10 }}
                >
                  <IconAvatar
                    fallbackText={member.name}
                    size={40}
                    radius={20}
                  />
                </View>
              ))}
            </View>
            <Text className="mt-3 text-sm font-bold text-gray-500">
              {membersPreview.totalCount} members
            </Text>
          </>
        ) : (
          <ActivityIndicator color={THEME.primary} />
        )}
      </View>

      <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
        <View className="mb-3 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Compass size={19} color={THEME.primary} />
            <Text className="text-lg font-black text-gray-950">Circles</Text>
          </View>
          <TouchableOpacity onPress={onSeeAllCircles}>
            <Text className="text-sm font-black" style={{ color: THEME.primary }}>
              See all
            </Text>
          </TouchableOpacity>
        </View>
        {circles.length > 0 ? (
          <View className="gap-2">
            {circles.slice(0, 5).map((circle) => (
              <TouchableOpacity
                key={circle.id}
                onPress={() => onOpenCircle(circle)}
                className="flex-row items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3"
              >
                <IconAvatar
                  emoji={circle.iconEmoji}
                  color={circle.iconColor}
                  colorKey={circle.colorKey}
                  fallbackText={circle.name}
                  size={40}
                  radius={12}
                />
                <View className="min-w-0 flex-1">
                  <Text className="font-black text-gray-900" numberOfLines={1}>
                    {circle.name}
                  </Text>
                  <Text className="text-xs font-semibold text-gray-500">
                    {circle.privacy === 'public' ? 'Public' : 'Private'} ·{' '}
                    {circle.memberCount} members
                  </Text>
                </View>
                <ChevronRight size={16} color={THEME.muted} />
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text className="text-sm leading-5 text-gray-600">
            No circles yet.
          </Text>
        )}
        <TouchableOpacity
          onPress={onSeeAllCircles}
          className="mt-3 flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-3"
        >
          <Text className="font-black text-gray-700">+ Start a circle</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

function GovernanceTab({
  config,
  proposals,
  onViewAllProposals,
  onOpenProposal,
}: {
  config: CoopConfigDetail;
  proposals: ProposalSummary[];
  onViewAllProposals: () => void;
  onOpenProposal: (id: string) => void;
}) {
  return (
    <>
      <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
        <View className="mb-3 flex-row items-center gap-2">
          <Gavel size={19} color={THEME.primary} />
          <Text className="text-lg font-black text-gray-950">
            How decisions work
          </Text>
        </View>
        <View className="gap-3">
          {[
            {
              step: '1',
              title: 'Discuss',
              body: 'Members shape an idea in posts or circles.',
            },
            {
              step: '2',
              title: 'Propose',
              body: 'Formal requests include a plan, budget, and owner.',
            },
            {
              step: '3',
              title: 'Decide',
              body: 'The decision path depends on the amount requested.',
            },
          ].map((item) => (
            <View key={item.step} className="flex-row items-start gap-3">
              <View
                className="h-7 w-7 items-center justify-center rounded-full"
                style={{ backgroundColor: THEME.primarySoft }}
              >
                <Text className="text-xs font-black" style={{ color: THEME.primary }}>
                  {item.step}
                </Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="font-black text-gray-900">{item.title}</Text>
                <Text className="mt-0.5 text-sm leading-5 text-gray-600">
                  {item.body}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
        <Text className="mb-3 text-lg font-black text-gray-950">
          Funding thresholds
        </Text>
        <View className="flex-row gap-2">
          <View className="flex-1 rounded-xl bg-gray-50 p-3">
            <Text className="text-xs font-bold text-gray-500">
              $0 – {formatMoney(config.aiAutoApproveThresholdUSD)}
            </Text>
            <Text className="mt-1 text-xs font-black text-gray-900">
              Small proposal lane
            </Text>
          </View>
          <View className="flex-1 rounded-xl bg-gray-50 p-3">
            <Text className="text-xs font-bold text-gray-500">
              {formatMoney((config.aiAutoApproveThresholdUSD || 0) + 1)} –{' '}
              {formatMoney(config.councilVoteThresholdUSD)}
            </Text>
            <Text className="mt-1 text-xs font-black text-gray-900">
              Council review
            </Text>
          </View>
          <View className="flex-1 rounded-xl bg-gray-50 p-3">
            <Text className="text-xs font-bold text-gray-500">
              {formatMoney(config.councilVoteThresholdUSD)}+
            </Text>
            <Text className="mt-1 text-xs font-black text-gray-900">
              Commons vote
            </Text>
          </View>
        </View>
        <View className="mt-3 flex-row justify-between border-t border-gray-100 pt-3">
          <Text className="text-sm font-semibold text-gray-500">
            Member approval threshold
          </Text>
          <Text className="text-sm font-black text-gray-900">
            {formatPercent(config.approvalThresholdPercent)}
          </Text>
        </View>
      </View>

      <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
        <View className="mb-3 flex-row items-center gap-2">
          <CircleDollarSign size={19} color={THEME.green} />
          <Text className="text-lg font-black text-gray-950">Treasury</Text>
        </View>
        <View
          className="rounded-xl p-3"
          style={{ backgroundColor: THEME.greenSoft }}
        >
          <Text
            className="text-xs font-bold uppercase"
            style={{ color: THEME.green }}
          >
            Cash balance
          </Text>
          <Text className="mt-1 text-2xl font-black text-gray-950">
            Not connected
          </Text>
          <Text className="mt-1 text-sm leading-5 text-gray-700">
            This page is ready for a per-commons cash balance once treasury
            accounting is exposed to members.
          </Text>
        </View>
        <View className="mt-3 gap-2">
          <View className="flex-row justify-between gap-3">
            <Text className="text-sm font-semibold text-gray-500">
              Treasury safe
            </Text>
            <Text className="flex-1 text-right text-sm font-black text-gray-900">
              {shortAddress(config.treasurySafeAddress)}
            </Text>
          </View>
        </View>
      </View>

      <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
        <View className="mb-3 flex-row items-center justify-between gap-3">
          <View className="flex-row items-center gap-2">
            <FileText size={19} color={THEME.blue} />
            <Text className="text-lg font-black text-gray-950">
              Recent proposals
            </Text>
          </View>
          <TouchableOpacity onPress={onViewAllProposals}>
            <Text className="text-sm font-black" style={{ color: THEME.primary }}>
              View all
            </Text>
          </TouchableOpacity>
        </View>
        {proposals.length > 0 ? (
          <View className="gap-3">
            {proposals.map((proposal) => (
              <TouchableOpacity
                key={proposal.id}
                onPress={() => onOpenProposal(proposal.id)}
                className="rounded-xl border border-gray-100 bg-gray-50 p-3"
                activeOpacity={0.75}
              >
                <View className="mb-2 flex-row items-start justify-between gap-3">
                  <Text
                    className="min-w-0 flex-1 font-black leading-5 text-gray-900"
                    numberOfLines={2}
                  >
                    {proposal.title}
                  </Text>
                  <View
                    className="rounded-full px-2 py-1"
                    style={{ backgroundColor: THEME.primarySoft }}
                  >
                    <Text
                      className="text-xs font-black"
                      style={{ color: THEME.primary }}
                    >
                      {statusLabel(proposal.status)}
                    </Text>
                  </View>
                </View>
                <Text
                  className="text-sm leading-5 text-gray-600"
                  numberOfLines={2}
                >
                  {proposal.summary}
                </Text>
                <Text className="mt-2 text-xs font-bold text-gray-500">
                  {proposal.category} - {proposalBudget(proposal)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text className="text-sm leading-5 text-gray-600">
            No proposals are open yet. This is where formal requests,
            budgets, votes, and funding decisions will live.
          </Text>
        )}
      </View>
    </>
  );
}
