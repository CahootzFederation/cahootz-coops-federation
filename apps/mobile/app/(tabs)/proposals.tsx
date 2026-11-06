import { CommunityTheme } from '@/constants/theme';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleEllipsis,
  Clock,
  FileText,
  Menu,
  MessageCircle,
  PencilLine,
  Plus,
  Vote,
  X,
} from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { LoadError } from '@/components/load-error';
import { WalletGate } from '@/components/wallet-gate';
import { api, type CommonsDirectoryItem, type ProposalSummary } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { useAuth } from '@/contexts/auth-context';
import { useCommonsProposalActions } from '@/hooks/use-commons-proposal-actions';
import { track } from '@/lib/analytics';
import { proposalDetailHref, proposalDraftsHref } from '@/lib/proposal-navigation';
import { votingDeadlineShort } from '@/lib/voting-deadline';
import { SubmitModal } from '../(authenticated)/proposals';

const PRIMARY = CommunityTheme.primary;
const BORDER = CommunityTheme.border;

const DEFAULT_COMMONS: CommonsDirectoryItem = {
  id: 'cahootz',
  name: 'Commons',
  shortName: 'Commons',
  description: 'Shared proposals and member decisions.',
  accessStatus: 'ACTIVE',
  isMember: false,
  isLocked: false,
  canApply: false,
};

function statusLabel(status: string) {
  switch (status) {
    case 'submitted':
      return 'AI Review';
    case 'votable':
      return 'Deliberation';
    case 'approved':
      return 'Approved';
    case 'funded':
      return 'Funded';
    case 'rejected':
      return 'Rejected';
    case 'withdrawn':
      return 'Withdrawn';
    default:
      return status || 'Open';
  }
}

function formatBudget(proposal: ProposalSummary) {
  const amount = proposal.budget?.amount;
  const currency = proposal.budget?.currency || 'USD';
  if (!amount) return null;

  if (currency !== 'USD') {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount)} ${currency}`;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function timeAgo(dateString: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(dateString).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ProposalsScreen() {
  return (
    <WalletGate>
      <ProposalsHub />
    </WalletGate>
  );
}

function ProposalsHub() {
  const params = useLocalSearchParams<{ coopId?: string; submit?: string }>();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, sessionToken, user, isLoading: authLoading } = useAuth();
  const [commons, setCommons] = useState<CommonsDirectoryItem[]>([DEFAULT_COMMONS]);
  const [selectedCommonsId, setSelectedCommonsId] = useState(params.coopId || DEFAULT_COMMONS.id);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [showSubmit, setShowSubmit] = useState(params.submit === '1' || params.submit === 'true');
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showActionableOnly, setShowActionableOnly] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const isHistory = (proposal: ProposalSummary) => ['approved', 'funded', 'rejected', 'withdrawn'].includes(proposal.status);
  const shouldOpenSubmit = params.submit === '1' || params.submit === 'true';

  const selectedCommons = useMemo(
    () => commons.find((item) => item.id === selectedCommonsId) || commons[0] || DEFAULT_COMMONS,
    [commons, selectedCommonsId]
  );
  const proposalActions = useCommonsProposalActions({
    enabled: !authLoading,
    coopId: selectedCommons?.id,
    sessionToken,
    walletAddress: user?.walletAddress,
  });
  const visibleProposals = useMemo(
    () => showActionableOnly
      ? proposals.filter((proposal) => proposalActions.actionableProposalIds.includes(proposal.id))
      : proposals.filter((proposal) => isHistory(proposal) === showHistory),
    [proposalActions.actionableProposalIds, proposals, showActionableOnly, showHistory],
  );

  useEffect(() => { setShowActionableOnly(false); setShowHistory(false); }, [selectedCommonsId]);

  useEffect(() => {
    track('proposal_hub_viewed', { signed_in: isAuthenticated });
  }, [isAuthenticated, selectedCommonsId]);

  useEffect(() => {
    let mounted = true;

    api
      .listCommonsDirectory(sessionToken)
      .then((result) => {
        if (!mounted) return;
        const activeCommons = result.coops.filter((item) =>
          sessionToken ? item.accessStatus === 'ACTIVE' : !item.isLocked,
        );
        const nextCommons = activeCommons.length > 0 ? activeCommons : [DEFAULT_COMMONS];
        setCommons(nextCommons);
        setSelectedCommonsId((current) =>
          nextCommons.some((item) => item.id === params.coopId)
            ? params.coopId!
            : nextCommons.some((item) => item.id === current)
              ? current
              : nextCommons[0].id
        );
      })
      .catch((loadError) => {
        console.error('Failed to load proposal commons:', loadError);
        if (mounted) setCommons([DEFAULT_COMMONS]);
      });

    return () => {
      mounted = false;
    };
  }, [params.coopId, sessionToken]);

  const loadProposals = useCallback(async (showRefreshing = false) => {
    if (!selectedCommons?.id) return;
    if (showRefreshing) setRefreshing(true);
    if (!showRefreshing) setLoading(true);
    setError('');

    try {
      const result = await api.listProposals(
        { coopId: selectedCommons.id, limit: 30, offset: 0 },
        user?.walletAddress
      );
      setProposals(result?.proposals || []);
    } catch (loadError) {
      console.error('Failed to load proposals:', loadError);
      setProposals([]);
      setError(friendlyError(loadError, "We couldn't load proposals."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCommons?.id, user?.walletAddress]);

  useEffect(() => {
    void loadProposals(false);
  }, [loadProposals]);

  useEffect(() => {
    if (shouldOpenSubmit && user?.walletAddress) {
      setShowSubmit(true);
    }
  }, [shouldOpenSubmit, user?.walletAddress]);

  const handleOpenSubmit = useCallback(() => {
    if (!isAuthenticated) {
      router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
      return;
    }
    if (!selectedCommons.isMember) {
      router.push(`/commons/${selectedCommons.id}` as any);
      return;
    }
    if (!user?.walletAddress) {
      router.push('/(tabs)/wallet' as any);
      return;
    }
    setShowSubmit(true);
  }, [isAuthenticated, selectedCommons.id, selectedCommons.isMember, user?.walletAddress]);

  const handleSubmitClose = useCallback(() => {
    setShowSubmit(false);
    void loadProposals(false);
  }, [loadProposals]);

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadProposals(true)} tintColor={PRIMARY} />}
      >
        <View className="border-b border-gray-200 bg-white px-3 pb-2" style={{ paddingTop: insets.top + 12 }}>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/(tabs)', params: { coopId: selectedCommons.id } })}
              className="h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
              accessibilityLabel="Back to commons"
            >
              <Menu size={18} color="#1F2937" strokeWidth={2.6} />
            </TouchableOpacity>
            <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: PRIMARY }}>
              <CircleEllipsis size={17} color="#FFFFFF" strokeWidth={2.6} />
            </View>
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-1.5">
                <Text className="min-w-0 text-base font-black text-gray-950" numberOfLines={1}>
                  Proposals &amp; Votes
                </Text>
                {isAuthenticated ? (
                  <View className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5">
                    <Text className="text-[10px] font-black text-emerald-600">
                      {selectedCommons.isMember ? 'Member' : 'View only'}
                    </Text>
                  </View>
                ) : null}
              </View>
              <TouchableOpacity
                onPress={() => setSwitcherOpen(true)}
                className="mt-0.5 flex-row items-center"
                activeOpacity={0.75}
                accessibilityLabel="Switch commons"
              >
                <Text className="text-xs font-semibold text-slate-600" numberOfLines={1}>
                  {selectedCommons.name}
                </Text>
                <ChevronDown size={13} color="#475569" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/(tabs)/messages', params: { coopId: selectedCommons.id } })}
              className="relative h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
              accessibilityLabel="Open direct messages"
            >
              <MessageCircle size={16} color="#334155" />
              <View className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white" style={{ backgroundColor: PRIMARY }} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/(tabs)/notifications', params: { coopId: selectedCommons.id } })}
              className="relative h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
              accessibilityLabel="Open alerts"
            >
              <Bell size={16} color="#334155" />
              <View className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white" style={{ backgroundColor: PRIMARY }} />
            </TouchableOpacity>
          </View>
        </View>

        <View className="px-5 pt-4 pb-2">
          <Text className="text-2xl font-black text-gray-950">Community decisions</Text>
          <Text className="mt-2 text-base leading-6 text-gray-600">
            Review what’s happening in {selectedCommons.name}.
          </Text>
        </View>

        <View className="px-5 py-3">


          {proposalActions.loading && isAuthenticated ? <Text accessibilityLiveRegion="polite" className="py-3 text-sm text-gray-500">Checking drafts and votes…</Text> : null}
          {proposalActions.failed ? (
            <View className="py-3">
              <LoadError message="We couldn't check your drafts and votes." onRetry={proposalActions.retry} />
            </View>
          ) : null}
          {proposalActions.canVote && !proposalActions.loading && !proposalActions.failed ? (
            <TouchableOpacity
              onPress={() => { setShowActionableOnly((current) => !current); setShowHistory(false); }}
              className="mt-3 flex-row items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3"
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityState={{ selected: showActionableOnly }}
              accessibilityLabel={`${proposalActions.actionableVoteCount} proposals need your vote`}
            >
              <View className="flex-row items-center gap-2">
                <Vote size={18} color={PRIMARY} />
                <Text className="font-semibold text-gray-900">
                  {proposalActions.actionableVoteCount} need your vote
                </Text>
              </View>
              <Text className="text-xs font-black text-orange-700">{showActionableOnly ? 'Show all' : 'Review'}</Text>
            </TouchableOpacity>
          ) : null}

          {isAuthenticated ? (
            <TouchableOpacity
              onPress={() => {
                track('proposal_navigation_opened', {
                  source: 'proposal_hub', destination: 'drafts', draft_count: proposalActions.draftCount,
                });
                router.push(proposalDraftsHref(selectedCommons.id, selectedCommons.name) as any);
              }}
              className="mt-3 flex-row items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4"
              activeOpacity={0.75}
              accessibilityLabel={`Continue proposal drafts in ${selectedCommons.name}`}
            >
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-stone-100">
                <FileText size={19} color={PRIMARY} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="font-black text-gray-950">Continue drafts</Text>
                <Text className="mt-0.5 text-sm text-gray-500">
                  {proposalActions.loading
                    ? 'Checking saved drafts…'
                    : proposalActions.draftCount > 0
                    ? `${proposalActions.draftCount} ${proposalActions.draftCount === 1 ? 'draft' : 'drafts'} in this commons`
                    : proposalActions.failed
                      ? 'Open to see your drafts'
                      : 'No saved drafts in this commons'}
                </Text>
              </View>
              <ChevronDown size={17} color="#78716C" style={{ transform: [{ rotate: '-90deg' }] }} />
            </TouchableOpacity>
          ) : null}



          <TouchableOpacity
            accessibilityRole="button"
            onPress={handleOpenSubmit}
            className="mt-3 min-h-11 flex-row rounded-xl border px-4 py-2"
            style={{ backgroundColor: CommunityTheme.sheet, borderColor: BORDER }}
            activeOpacity={0.8}
          >
            <View className="flex-row items-center gap-3">
              <View className="h-8 w-8 items-center justify-center">
                <PencilLine size={20} color={PRIMARY} />
              </View>
              <View className="flex-1">
                <Text className="font-semibold" style={{ color: CommunityTheme.ink }}>
                  {!isAuthenticated
                    ? 'Sign in to propose'
                    : !selectedCommons.isMember
                      ? 'Join this commons to propose'
                      : !user?.walletAddress
                        ? 'Connect wallet to propose'
                        : 'Start a proposal'}
                </Text>

              </View>
              <Plus size={20} color={PRIMARY} />
            </View>
          </TouchableOpacity>

          <View accessibilityRole="tablist" className="mt-5 flex-row gap-2">
            {['Current', 'History'].map((label) => (
              <TouchableOpacity key={label} accessibilityRole="tab"
                accessibilityState={{ selected: !showActionableOnly && showHistory === (label === 'History') }}
                aria-selected={!showActionableOnly && showHistory === (label === 'History')}
                onPress={() => { setShowActionableOnly(false); setShowHistory(label === 'History'); }}
                className="min-h-11 flex-1 items-center justify-center rounded-xl border bg-white px-3"
                style={{ borderColor: !showActionableOnly && showHistory === (label === 'History') ? PRIMARY : BORDER }}>
                <Text style={{ color: CommunityTheme.ink, fontWeight: '600' }}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {loading || (showActionableOnly && proposalActions.loading) ? (
            <View className="items-center py-16">
              <ActivityIndicator size="large" color={PRIMARY} />
              <Text className="mt-3 text-sm font-semibold text-gray-500">Loading proposals...</Text>
            </View>
          ) : error ? (
            <View className="mt-5">
              <LoadError message={error} onRetry={() => void loadProposals(false)} />
            </View>
          ) : showActionableOnly && proposalActions.failed ? (
            <Text className="py-6 text-base text-gray-600">Your voting status is unavailable. Try again above or browse current proposals.</Text>
          ) : visibleProposals.length === 0 ? (
            <View className="mt-5 rounded-[28px] border border-dashed border-stone-300 bg-white p-6">
              <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl bg-orange-50">
                <Vote size={26} color={PRIMARY} />
              </View>
              <Text className="text-xl font-black text-gray-950">
                {showActionableOnly ? 'You are caught up' : showHistory ? 'No past proposals yet' : 'No current proposals'}
              </Text>
              <Text className="mt-2 text-base leading-6 text-gray-600">
                {showActionableOnly
                  ? `There are no proposals waiting for your vote in ${selectedCommons.name}.`
                  : showHistory ? 'Decided and withdrawn proposals will stay here for reference.' : `New proposals in ${selectedCommons.name} will appear here. You can find past decisions in History.`}
              </Text>
            </View>
          ) : (
            <View className="mt-5 gap-3">
              {visibleProposals.map((proposal) => {
                const budget = formatBudget(proposal);
                const closing = votingDeadlineShort(proposal);
                return (
                  <TouchableOpacity
                    key={proposal.id}
                    onPress={() => {
                      track('proposal_navigation_opened', { source: 'proposal_hub', destination: 'detail' });
                      router.push(proposalDetailHref(proposal.id, selectedCommons.id) as any);
                    }}
                    className="rounded-2xl border bg-white p-4"
                    style={{ borderColor: BORDER }}
                    activeOpacity={0.75}
                  >
                    <View className="items-start gap-3">
                      <View className="w-full">
                        <Text className="text-lg font-black text-gray-950" numberOfLines={2}>
                          {proposal.title}
                        </Text>
                        <Text className="mt-2 text-sm leading-5 text-gray-600" numberOfLines={3}>
                          {proposal.summary}
                        </Text>
                      </View>
                      <View className="rounded-full bg-orange-50 px-3 py-1">
                        <Text className="text-xs font-black" style={{ color: PRIMARY }}>
                          {statusLabel(proposal.status)}
                        </Text>
                      </View>
                    </View>

                    <View className="mt-4 flex-row items-center justify-between">
                      <View className="min-w-0 flex-1">
                        <Text className="text-xs font-black uppercase text-gray-500">{proposal.category}</Text>
                        <Text className="mt-1 text-xs font-semibold text-gray-500" numberOfLines={1}>
                          {proposal.proposer?.displayName || 'Commons member'} · {timeAgo(proposal.createdAt)}
                        </Text>
                        {closing ? (
                          <View className="mt-2 flex-row items-center gap-1">
                            <Clock size={14} color="#374151" />
                            <Text className="text-sm font-bold text-gray-800">{closing}</Text>
                          </View>
                        ) : null}
                      </View>
                      {budget ? (
                        <View className="flex-row items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5">
                          <CheckCircle2 size={14} color="#059669" />
                          <Text className="text-xs font-black text-emerald-700">{budget}</Text>
                        </View>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal visible={switcherOpen} transparent animationType="slide" onRequestClose={() => setSwitcherOpen(false)}>
        <View className="flex-1 justify-end bg-black/35">
          <View className="max-h-[70%] rounded-t-2xl bg-white">
            <View className="border-b border-gray-200 px-5 pb-4 pt-5">
              <View className="flex-row items-center justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-black uppercase text-gray-500">Proposal commons</Text>
                  <Text className="text-2xl font-black text-gray-950">Switch commons</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSwitcherOpen(false)}
                  className="h-10 w-10 items-center justify-center rounded-xl bg-gray-100"
                  accessibilityLabel="Close commons switcher"
                >
                  <X size={20} color="#111827" />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 26 }}>
              <View className="gap-2">
                {commons.map((item) => {
                  const selected = item.id === selectedCommons.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => {
                        setSelectedCommonsId(item.id);
                        setSwitcherOpen(false);
                      }}
                      className="flex-row items-center gap-3 rounded-xl border p-3"
                      style={{
                        backgroundColor: selected ? '#FFF7ED' : '#FFFFFF',
                        borderColor: selected ? PRIMARY : BORDER,
                      }}
                      activeOpacity={0.75}
                    >
                      <View
                        className="h-11 w-11 items-center justify-center rounded-xl"
                        style={{ backgroundColor: selected ? PRIMARY : '#111827' }}
                      >
                        <Text className="font-black text-white">{item.name.slice(0, 1).toUpperCase()}</Text>
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="font-black text-gray-950" numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text className="mt-0.5 text-xs leading-4 text-gray-500" numberOfLines={2}>
                          {item.description || 'Member commons'}
                        </Text>
                      </View>
                      {selected ? <CheckCircle2 size={19} color={PRIMARY} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {user?.walletAddress ? (
        <SubmitModal
          visible={showSubmit}
          onClose={handleSubmitClose}
          walletAddress={user.walletAddress}
          coopId={selectedCommons.id}
          coopName={selectedCommons.name}
          primaryColor={PRIMARY}
          accentColor={PRIMARY}
        />
      ) : null}
    </View>
  );
}
