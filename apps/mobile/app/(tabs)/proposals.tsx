import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  CircleEllipsis,
  Menu,
  MessageCircle,
  PencilLine,
  Plus,
  Vote,
  X,
} from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { api, type CommonsDirectoryItem, type ProposalSummary } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { SubmitModal } from '../(authenticated)/proposals';

const PRIMARY = '#FF6B00';
const BORDER = '#E5E7EB';

const DEFAULT_COMMONS: CommonsDirectoryItem = {
  id: 'cahootz',
  name: 'Commons',
  shortName: 'Commons',
  description: 'Shared proposals and member decisions.',
  accessStatus: 'ACTIVE',
  isMember: true,
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
  const params = useLocalSearchParams<{ coopId?: string; submit?: string }>();
  const insets = useSafeAreaInsets();
  const { sessionToken, user } = useAuth();
  const [commons, setCommons] = useState<CommonsDirectoryItem[]>([DEFAULT_COMMONS]);
  const [selectedCommonsId, setSelectedCommonsId] = useState(params.coopId || DEFAULT_COMMONS.id);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [showSubmit, setShowSubmit] = useState(params.submit === '1' || params.submit === 'true');
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const shouldOpenSubmit = params.submit === '1' || params.submit === 'true';

  const selectedCommons = useMemo(
    () => commons.find((item) => item.id === selectedCommonsId) || commons[0] || DEFAULT_COMMONS,
    [commons, selectedCommonsId]
  );

  useEffect(() => {
    let mounted = true;

    if (!sessionToken) {
      setCommons([DEFAULT_COMMONS]);
      setSelectedCommonsId(DEFAULT_COMMONS.id);
      return () => {
        mounted = false;
      };
    }

    api
      .listCommonsDirectory(sessionToken)
      .then((result) => {
        if (!mounted) return;
        const activeCommons = result.coops.filter((item) => item.accessStatus === 'ACTIVE');
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
      setError(loadError instanceof Error ? loadError.message : 'Could not load proposals.');
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
    if (!user?.walletAddress) {
      setError('Add or connect your wallet before submitting a proposal.');
      return;
    }
    setShowSubmit(true);
  }, [user?.walletAddress]);

  const handleSubmitClose = useCallback(() => {
    setShowSubmit(false);
    void loadProposals(false);
  }, [loadProposals]);

  return (
    <View className="flex-1 bg-stone-50">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadProposals(true)} tintColor={PRIMARY} />}
      >
        <View className="border-b border-gray-200 bg-white px-3 pb-2" style={{ paddingTop: insets.top + 12 }}>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={() => router.push('/(tabs)' as any)}
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
                  Proposals
                </Text>
                <View className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5">
                  <Text className="text-[10px] font-black text-emerald-600">Member</Text>
                </View>
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
              onPress={() => router.push('/(tabs)/messages' as any)}
              className="relative h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
              accessibilityLabel="Open direct messages"
            >
              <MessageCircle size={16} color="#334155" />
              <View className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white" style={{ backgroundColor: PRIMARY }} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/notifications' as any)}
              className="relative h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50"
              accessibilityLabel="Open alerts"
            >
              <Bell size={16} color="#334155" />
              <View className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white" style={{ backgroundColor: PRIMARY }} />
            </TouchableOpacity>
          </View>
        </View>

        <View className="px-5 pt-4 pb-2">
          <Text className="text-2xl font-black text-gray-950">Turn conversations into decisions</Text>
          <Text className="mt-2 text-base leading-6 text-gray-600">
            Showing proposals submitted inside {selectedCommons.name}.
          </Text>
        </View>

        <View className="px-5 py-3">
          <TouchableOpacity
            onPress={handleOpenSubmit}
            className="rounded-2xl p-4"
            style={{ backgroundColor: PRIMARY }}
            activeOpacity={0.8}
          >
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-white/20">
                <PencilLine size={20} color="white" />
              </View>
              <View className="flex-1">
                <Text className="font-black text-white">Submit from chat</Text>
                <Text className="mt-1 text-sm leading-5 text-white/80">
                  Commons AI can draft the need, options, people, budget, and vote language.
                </Text>
              </View>
              <Plus size={20} color="white" />
            </View>
          </TouchableOpacity>

          {error ? (
            <View className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4">
              <Text className="text-sm font-semibold text-red-700">{error}</Text>
            </View>
          ) : null}

          {loading ? (
            <View className="items-center py-16">
              <ActivityIndicator size="large" color={PRIMARY} />
              <Text className="mt-3 text-sm font-semibold text-gray-500">Loading proposals...</Text>
            </View>
          ) : proposals.length === 0 ? (
            <View className="mt-5 rounded-[28px] border border-dashed border-stone-300 bg-white p-6">
              <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl bg-orange-50">
                <Vote size={26} color={PRIMARY} />
              </View>
              <Text className="text-xl font-black text-gray-950">No proposals yet</Text>
              <Text className="mt-2 text-base leading-6 text-gray-600">
                Proposals created inside {selectedCommons.name} will show here once they are ready for review.
              </Text>
            </View>
          ) : (
            <View className="mt-5 gap-3">
              {proposals.map((proposal) => {
                const budget = formatBudget(proposal);
                return (
                  <TouchableOpacity
                    key={proposal.id}
                    onPress={() => router.push(`/(tabs)/proposal-detail?id=${proposal.id}` as any)}
                    className="rounded-2xl border bg-white p-4"
                    style={{ borderColor: BORDER }}
                    activeOpacity={0.75}
                  >
                    <View className="flex-row items-start justify-between gap-3">
                      <View className="min-w-0 flex-1">
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
