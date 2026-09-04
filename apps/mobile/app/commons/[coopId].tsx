import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Banknote,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Flag,
  Lock,
  MessageCircle,
  Send,
  Target,
  Vote,
} from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { api, type ApplicationQuestion, type CommonsAccessStatus, type CommonsDirectoryItem, type CoopConfigDetail, type ProposalSummary } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

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
  description: 'A social commons for conversation, resources, and coordinated action.',
  displayMission: 'Members turn useful conversations into proposals, shared resources, and coordinated action.',
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

function formatMoney(value?: number, currency = 'USD') {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'Not connected';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
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
  return formatMoney(proposal.budget?.amount, proposal.budget?.currency || 'USD');
}

function accessCopy(status: CommonsAccessStatus) {
  if (status === 'ACTIVE') return { label: 'Member', bg: THEME.greenSoft, fg: THEME.green };
  if (status === 'PENDING') return { label: 'Application pending', bg: THEME.blueSoft, fg: THEME.blue };
  if (status === 'REJECTED') return { label: 'Application closed', bg: THEME.redSoft, fg: THEME.red };
  return { label: 'Locked', bg: THEME.primarySoft, fg: THEME.primary };
}

function isEmailQuestion(question: ApplicationQuestion) {
  const id = question.id.toLowerCase();
  const label = question.label.toLowerCase();
  return question.type === 'email' || id === 'email' || id.includes('email') || label.includes('email');
}

function isPhoneQuestion(question: ApplicationQuestion) {
  const id = question.id.toLowerCase();
  const label = question.label.toLowerCase();
  return question.type === 'phone' || id === 'phone' || id.includes('phone') || label.includes('phone');
}

export default function CommonsDetailScreen() {
  const params = useLocalSearchParams<{ coopId?: string }>();
  const coopId = params.coopId || 'cahootz';
  const { sessionToken, user } = useAuth();
  const [config, setConfig] = useState<CoopConfigDetail | null>(null);
  const [directoryItem, setDirectoryItem] = useState<CommonsDirectoryItem | null>(null);
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyName, setApplyName] = useState(user?.name || '');
  const [applyPhone, setApplyPhone] = useState(user?.phone || '');
  const [applicationAnswers, setApplicationAnswers] = useState<Record<string, unknown>>({});
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
        const currentDirectoryItem = directoryResult.coops.find((item) => item.id === coopId) || null;
        const hasMemberAccess = currentDirectoryItem?.accessStatus === 'ACTIVE';
        const proposalsResult = hasMemberAccess
          ? await api.listProposals({ coopId, limit: 5, offset: 0 }, user?.walletAddress)
          : { proposals: [] };
        if (!mounted) return;
        setConfig(configResult || { ...DEFAULT_CONFIG, coopId });
        setDirectoryItem(currentDirectoryItem);
        setProposals(proposalsResult?.proposals || []);
      } catch (err) {
        console.error('Failed to load commons detail:', err);
        if (!mounted) return;
        setConfig({ ...DEFAULT_CONFIG, coopId });
        setDirectoryItem(null);
        setProposals([]);
        setError('Could not load the full commons page. Showing the starter view.');
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
  const description = activeConfig.description || activeConfig.displayMission || DEFAULT_CONFIG.description;
  const accessStatus = directoryItem?.accessStatus || 'LOCKED';
  const accessTone = accessCopy(accessStatus);
  const isMember = accessStatus === 'ACTIVE';
  const canApply = accessStatus === 'LOCKED';
  const visibleApplicationQuestions = useMemo(
    () => (activeConfig.applicationQuestions || []).filter((question) => !isEmailQuestion(question)),
    [activeConfig.applicationQuestions]
  );
  const phoneQuestion = useMemo(
    () => visibleApplicationQuestions.find((question) => isPhoneQuestion(question)),
    [visibleApplicationQuestions]
  );
  const needsProfileName = !user?.name?.trim();
  const needsProfilePhone = !user?.phone?.trim() && !phoneQuestion;
  const canOpenApply = canApply && !!sessionToken && !!user;
  const activeCategories = useMemo(
    () => activeConfig.proposalCategories.filter((category) => category.isActive).slice(0, 4),
    [activeConfig.proposalCategories]
  );
  const charterPreview = activeConfig.charterText.length > 520
    ? `${activeConfig.charterText.slice(0, 520).trim()}...`
    : activeConfig.charterText;

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
      const result = await api.applyToCommons({
        coopId,
        displayName,
        phone,
        dynamicAnswers: {
          ...applicationAnswers,
          source: 'mobile_commons_detail',
        },
      }, sessionToken);

      setDirectoryItem((current) => ({
        id: current?.id || coopId,
        name: current?.name || name,
        shortName: current?.shortName || activeConfig.slug || name,
        description: current?.description || description || DEFAULT_CONFIG.description || 'A commons for shared conversation, resources, and coordinated action.',
        tagline: current?.tagline || activeConfig.tagline,
        mission: current?.mission || activeConfig.displayMission,
        eligibility: current?.eligibility || activeConfig.eligibility,
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
      setApplyError(err instanceof Error ? err.message : 'Could not submit application.');
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
            {question.label}{question.required ? ' *' : ''}
          </Text>
          {question.description ? <Text className="mt-1 text-sm leading-5 text-gray-600">{question.description}</Text> : null}
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
                  <Text className="font-bold" style={{ color: selected ? THEME.primary : THEME.ink }}>
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
      const selectedValues = Array.isArray(answer) ? answer as string[] : [];
      return (
        <View key={question.id}>
          <Text className="font-black text-gray-900">
            {question.label}{question.required ? ' *' : ''}
          </Text>
          {question.description ? <Text className="mt-1 text-sm leading-5 text-gray-600">{question.description}</Text> : null}
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
                        ? selectedValues.filter((value) => value !== option.value)
                        : [...selectedValues, option.value]
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
                    {selected ? <CheckCircle2 size={13} color="#FFFFFF" /> : null}
                  </View>
                  <Text className="min-w-0 flex-1 font-bold" style={{ color: selected ? THEME.primary : THEME.ink }}>
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
          {question.label}{question.required ? ' *' : ''}
        </Text>
        {question.description ? <Text className="mt-1 text-sm leading-5 text-gray-600">{question.description}</Text> : null}
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
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
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
              <View className="h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: THEME.primary }}>
                {isMember ? (
                  <Text className="text-2xl font-black text-white">{name.slice(0, 1).toUpperCase()}</Text>
                ) : (
                  <Lock size={24} color="#FFFFFF" />
                )}
              </View>
              <View className="min-w-0 flex-1">
                <View className="mb-1 flex-row items-center gap-2">
                  <Text className="text-xs font-black uppercase text-gray-500">Commons</Text>
                  <View className="rounded-full px-2 py-1" style={{ backgroundColor: accessTone.bg }}>
                    <Text className="text-xs font-black" style={{ color: accessTone.fg }}>{accessTone.label}</Text>
                  </View>
                </View>
                <Text className="text-3xl font-black leading-9 text-gray-950">{name}</Text>
                {activeConfig.tagline ? (
                  <Text className="mt-1 text-sm font-bold" style={{ color: THEME.primary }}>
                    {activeConfig.tagline}
                  </Text>
                ) : null}
              </View>
            </View>
            <Text className="text-base leading-6 text-gray-700">{description}</Text>

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
                  onPress={() => canOpenApply ? setApplyOpen(true) : undefined}
                  disabled={!canOpenApply}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-xl px-4 py-3"
                  style={{ backgroundColor: canOpenApply ? THEME.primary : THEME.border }}
                >
                  {canOpenApply ? <Send size={17} color="white" /> : <CheckCircle2 size={17} color={THEME.muted} />}
                  <Text className={canOpenApply ? 'font-black text-white' : 'font-black text-gray-500'}>
                    {canApply && !canOpenApply ? 'Sign in to apply' : canOpenApply ? 'Apply to join' : accessTone.label}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity className="h-12 w-12 items-center justify-center rounded-xl border border-gray-200 bg-white">
                <ChevronRight size={20} color={THEME.ink} />
              </TouchableOpacity>
            </View>
          </View>

          {error ? (
            <View className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
              <Text className="text-sm font-semibold text-orange-800">{error}</Text>
            </View>
          ) : null}
        </View>

        <View className="px-4">
          {loading ? (
            <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-5">
              <ActivityIndicator color={THEME.primary} />
              <Text className="mt-3 text-center text-sm font-semibold text-gray-500">Loading commons...</Text>
            </View>
          ) : null}

          {!isMember ? (
            <View className="mb-3 rounded-2xl border p-4" style={{ borderColor: THEME.primaryBorder, backgroundColor: THEME.primarySoft }}>
              <View className="flex-row items-start gap-3">
                <Lock size={20} color={THEME.primary} />
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-black text-gray-950">
                    {accessStatus === 'PENDING' ? 'Application pending' : 'Membership required'}
                  </Text>
                  <Text className="mt-1 text-sm leading-5 text-gray-700">
                    {accessStatus === 'PENDING'
                      ? 'You applied to this commons. The feed, charter, goals, proposals, and treasury unlock after approval.'
                      : 'Apply to join this commons. Internal posts, charter, goals, proposals, and treasury are only visible to approved members.'}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {isMember ? (
            <>
          <View className="mb-3 flex-row gap-2">
            <View className="flex-1 rounded-xl border border-gray-200 bg-white p-3">
              <Banknote size={18} color={THEME.green} />
              <Text className="mt-2 text-xs font-bold uppercase text-gray-500">Cash</Text>
              <Text className="mt-1 text-lg font-black text-gray-950">{isMember ? formatMoney(undefined) : 'Locked'}</Text>
            </View>
            <View className="flex-1 rounded-xl border border-gray-200 bg-white p-3">
              <FileText size={18} color={THEME.blue} />
              <Text className="mt-2 text-xs font-bold uppercase text-gray-500">Proposals</Text>
              <Text className="mt-1 text-lg font-black text-gray-950">{isMember ? proposals.length : 'Locked'}</Text>
            </View>
            <View className="flex-1 rounded-xl border border-gray-200 bg-white p-3">
              <Flag size={18} color={THEME.primary} />
              <Text className="mt-2 text-xs font-bold uppercase text-gray-500">Vote</Text>
              <Text className="mt-1 text-lg font-black text-gray-950">{formatPercent(activeConfig.approvalThresholdPercent)}</Text>
            </View>
          </View>

          <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
            <View className="mb-3 flex-row items-center gap-2">
              <BookOpen size={19} color={THEME.primary} />
              <Text className="text-lg font-black text-gray-950">Charter</Text>
            </View>
            <Text className="text-sm leading-6 text-gray-700">{charterPreview}</Text>
          </View>

          <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
            <View className="mb-3 flex-row items-center gap-2">
              <Target size={19} color={THEME.primary} />
              <Text className="text-lg font-black text-gray-950">Goals</Text>
            </View>
            {activeConfig.missionGoals.length > 0 ? (
              <View className="gap-2">
                {activeConfig.missionGoals.map((goal) => (
                  <View key={goal.key} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <View className="flex-row items-start justify-between gap-3">
                      <Text className="min-w-0 flex-1 font-black text-gray-900">{goal.label}</Text>
                      <Text className="text-xs font-black" style={{ color: THEME.primary }}>
                        {Math.round(goal.priorityWeight * 100)}%
                      </Text>
                    </View>
                    {goal.description ? <Text className="mt-1 text-sm leading-5 text-gray-600">{goal.description}</Text> : null}
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-sm leading-5 text-gray-600">No goals have been published for this commons yet.</Text>
            )}
          </View>

          <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
            <View className="mb-3 flex-row items-center gap-2">
              <CircleDollarSign size={19} color={THEME.green} />
              <Text className="text-lg font-black text-gray-950">Treasury</Text>
            </View>
            {isMember ? (
              <>
                <View className="rounded-xl p-3" style={{ backgroundColor: THEME.greenSoft }}>
                  <Text className="text-xs font-bold uppercase" style={{ color: THEME.green }}>Cash balance</Text>
                  <Text className="mt-1 text-2xl font-black text-gray-950">Not connected</Text>
                  <Text className="mt-1 text-sm leading-5 text-gray-700">
                    This page is ready for a per-commons cash balance once treasury accounting is exposed to members.
                  </Text>
                </View>
                <View className="mt-3 gap-2">
                  <View className="flex-row justify-between gap-3">
                    <Text className="text-sm font-semibold text-gray-500">Treasury safe</Text>
                    <Text className="flex-1 text-right text-sm font-black text-gray-900">{shortAddress(activeConfig.treasurySafeAddress)}</Text>
                  </View>
                  <View className="flex-row justify-between gap-3">
                    <Text className="text-sm font-semibold text-gray-500">Small proposal lane</Text>
                    <Text className="text-sm font-black text-gray-900">{formatMoney(activeConfig.aiAutoApproveThresholdUSD)} and under</Text>
                  </View>
                  <View className="flex-row justify-between gap-3">
                    <Text className="text-sm font-semibold text-gray-500">Council threshold</Text>
                    <Text className="text-sm font-black text-gray-900">{formatMoney(activeConfig.councilVoteThresholdUSD)}+</Text>
                  </View>
                </View>
              </>
            ) : (
              <View className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
                <Text className="text-base font-black text-gray-900">Members see treasury details</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">
                  Cash balance, funding lanes, and safe details are visible after joining this commons.
                </Text>
              </View>
            )}
          </View>

          <View className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
            <View className="mb-3 flex-row items-center justify-between gap-3">
              <Text className="text-lg font-black text-gray-950">Recent proposals</Text>
              <TouchableOpacity disabled={!isMember} onPress={() => router.push(`/${coopId}/proposal` as any)}>
                <Text className="text-sm font-black" style={{ color: THEME.primary }}>View all</Text>
              </TouchableOpacity>
            </View>
            {!isMember ? (
              <View className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
                <Text className="text-base font-black text-gray-900">Proposal room locked</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">
                  You can apply from this page, then come back to see proposal history, votes, and funding requests.
                </Text>
              </View>
            ) : proposals.length > 0 ? (
              <View className="gap-3">
                {proposals.map((proposal) => (
                  <TouchableOpacity
                    key={proposal.id}
                    onPress={() => router.push(`/(tabs)/proposal-detail?id=${proposal.id}` as any)}
                    className="rounded-xl border border-gray-100 bg-gray-50 p-3"
                    activeOpacity={0.75}
                  >
                    <View className="mb-2 flex-row items-start justify-between gap-3">
                      <Text className="min-w-0 flex-1 font-black leading-5 text-gray-900" numberOfLines={2}>
                        {proposal.title}
                      </Text>
                      <View className="rounded-full px-2 py-1" style={{ backgroundColor: THEME.primarySoft }}>
                        <Text className="text-xs font-black" style={{ color: THEME.primary }}>{statusLabel(proposal.status)}</Text>
                      </View>
                    </View>
                    <Text className="text-sm leading-5 text-gray-600" numberOfLines={2}>{proposal.summary}</Text>
                    <Text className="mt-2 text-xs font-bold text-gray-500">{proposal.category} - {proposalBudget(proposal)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text className="text-sm leading-5 text-gray-600">
                No proposals are open yet. This is where formal requests, budgets, votes, and funding decisions will live.
              </Text>
            )}
          </View>

          {activeCategories.length > 0 ? (
            <View className="rounded-2xl border border-gray-200 bg-white p-4">
              <Text className="text-lg font-black text-gray-950">Proposal lanes</Text>
              <View className="mt-3 flex-row flex-wrap gap-2">
                {activeCategories.map((category) => (
                  <View key={category.key} className="rounded-full border px-3 py-2" style={{ borderColor: THEME.primaryBorder, backgroundColor: THEME.primarySoft }}>
                    <Text className="text-xs font-black" style={{ color: THEME.primary }}>{category.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>

      <Modal visible={applyOpen} transparent animationType="slide" onRequestClose={() => setApplyOpen(false)}>
        <View className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-3xl bg-white px-4 pb-8 pt-5" style={{ maxHeight: '88%' }}>
            {applySuccess ? (
              <View className="items-center py-6">
                <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: THEME.greenSoft }}>
                  <CheckCircle2 size={30} color={THEME.green} />
                </View>
                <Text className="text-center text-2xl font-black text-gray-950">Application sent</Text>
                <Text className="mt-2 text-center text-sm leading-5 text-gray-600">
                  Your request to join {name} is pending. This commons unlocks after approval.
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setApplyOpen(false);
                    setApplySuccess(false);
                  }}
                  className="mt-5 w-full rounded-xl px-4 py-3"
                  style={{ backgroundColor: THEME.primary }}
                >
                  <Text className="text-center font-black text-white">Done</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <View className="mb-4 flex-row items-start justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-xs font-black uppercase text-gray-500">Apply to join</Text>
                    <Text className="text-2xl font-black text-gray-950">{name}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setApplyOpen(false)} className="rounded-full bg-gray-100 px-3 py-2">
                    <Text className="font-black text-gray-700">Close</Text>
                  </TouchableOpacity>
                </View>

                <View className="mb-4 rounded-xl p-3" style={{ backgroundColor: THEME.primarySoft }}>
                  <Text className="text-xs font-black uppercase" style={{ color: THEME.primary }}>Applying as</Text>
                  <Text className="mt-1 text-base font-black text-gray-950">{user?.name || 'Your Cahootz account'}</Text>
                  <Text className="text-sm font-semibold text-gray-600">{user?.email}</Text>
                </View>

                <View className="gap-3">
                  {needsProfileName ? (
                    <View>
                      <Text className="font-black text-gray-900">Full name *</Text>
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
                  {visibleApplicationQuestions.map((question) => renderApplicationQuestion(question))}
                  {visibleApplicationQuestions.length === 0 ? (
                    <View className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
                      <Text className="text-base font-black text-gray-900">No extra questions</Text>
                      <Text className="mt-1 text-sm leading-5 text-gray-600">
                        This commons is only asking for your Cahootz account identity right now.
                      </Text>
                    </View>
                  ) : null}
                </View>

                {activeConfig.eligibility ? (
                  <View className="mt-3 rounded-xl bg-gray-50 p-3">
                    <Text className="text-xs font-black uppercase text-gray-500">Basic rules</Text>
                    <Text className="mt-1 text-sm leading-5 text-gray-700">{activeConfig.eligibility}</Text>
                  </View>
                ) : null}

                {applyError ? (
                  <View className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
                    <Text className="text-sm font-semibold text-orange-800">{applyError}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  onPress={handleApply}
                  disabled={applying}
                  className="mt-4 flex-row items-center justify-center gap-2 rounded-xl px-4 py-3"
                  style={{ backgroundColor: applying ? THEME.border : THEME.primary }}
                >
                  {applying ? <ActivityIndicator color={THEME.muted} /> : <Send size={17} color="white" />}
                  <Text className={applying ? 'font-black text-gray-500' : 'font-black text-white'}>
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
