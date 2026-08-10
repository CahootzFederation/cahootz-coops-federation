import React, { useState, useCallback, useEffect } from 'react';
import {
  ScrollView,
  View,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  MessageCircle,
  Sparkles,
  XCircle,
  AlertCircle,
  Shield,
  TrendingUp,
  FileText,
  Send,
  ThumbsUp,
  ChevronDown,
  ChevronUp,
  Users,
  LogOut,
  Pencil,
  RotateCcw,
  History,
} from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

function prettifyKey(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    submitted: 'AI Review', votable: 'Deliberation',
    approved: 'Approved', funded: 'Funded',
    rejected: 'Rejected', failed: 'Failed',
  };
  return map[status] ?? status;
}

function decisionColor(d?: string) {
  if (d === 'advance') return { bg: '#F0FDF4', border: '#86EFAC', text: '#15803D', label: 'Advance' };
  if (d === 'block')   return { bg: '#FEF2F2', border: '#FCA5A5', text: '#DC2626', label: 'Block' };
  return { bg: '#FFFBEB', border: '#FCD34D', text: '#B45309', label: 'Revise' };
}

function walletShort(w?: string) {
  if (!w || w.length < 12) return w ?? '';
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? '#16A34A' : pct >= 40 ? '#B45309' : '#DC2626';
  return (
    <View className="mb-3">
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-row items-center gap-1.5">
          {icon}
          <Text className="text-charcoal-600 text-xs">{label}</Text>
        </View>
        <Text className="text-charcoal-800 text-xs font-bold">{pct}%</Text>
      </View>
      <View className="h-2 rounded-full bg-cream-200">
        <View className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </View>
    </View>
  );
}

// ── Comment item ──────────────────────────────────────────────────────────────

function CommentItem({ comment }: { comment: any }) {
  const name = comment.authorName || walletShort(comment.authorWallet);
  const initials = name.slice(0, 2).toUpperCase();

  const alignmentColor: Record<string, string> = {
    ALIGNED: '#16A34A', NEUTRAL: '#B45309', MISALIGNED: '#DC2626',
  };
  const aiColor = comment.aiEvaluation ? alignmentColor[comment.aiEvaluation.alignment] : undefined;

  return (
    <View className="pb-4 mb-4 border-b border-cream-200 last:border-0">
      <View className="flex-row gap-3">
        <View className="w-9 h-9 rounded-full bg-gold-600 items-center justify-center flex-shrink-0">
          <Text className="text-white text-xs font-bold">{initials}</Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-center flex-wrap gap-1.5 mb-1">
            <Text className="text-charcoal-800 font-semibold text-sm">{name}</Text>
            <Text className="text-charcoal-400 text-xs">· {formatDate(comment.createdAt)}</Text>
          </View>
          <Text className="text-charcoal-600 text-sm leading-relaxed">{comment.content}</Text>

          {/* AI evaluation badge */}
          {comment.aiEvaluation && (
            <View className="mt-2 flex-row flex-wrap items-center gap-2">
              <View className="flex-row items-center gap-1" style={{ backgroundColor: `${aiColor}18`, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Sparkles size={11} color={aiColor} />
                <Text style={{ color: aiColor, fontSize: 11, fontWeight: '600' }}>
                  {comment.aiEvaluation.alignment}
                </Text>
              </View>
              {(comment.aiEvaluation.goalsImpacted ?? []).map((g: string) => (
                <View key={g} className="bg-cream-100 rounded-full px-2 py-0.5">
                  <Text className="text-charcoal-500 text-xs">{g}</Text>
                </View>
              ))}
            </View>
          )}
          {comment.aiEvaluation?.analysis && (
            <Text className="text-charcoal-400 text-xs mt-1 leading-relaxed">{comment.aiEvaluation.analysis}</Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProposalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [proposal, setProposal] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showFull, setShowFull] = useState(false);

  // Reactions state
  const [reactionCounts, setReactionCounts] = useState<{ support: number; concern: number; myReaction: 'SUPPORT' | 'CONCERN' | null }>({ support: 0, concern: 0, myReaction: null });
  const [reactingTo, setReactingTo] = useState<'SUPPORT' | 'CONCERN' | null>(null);

  // Withdraw state
  const [withdrawing, setWithdrawing] = useState(false);

  // Council vote state
  const [councilVoteResult, setCouncilVoteResult] = useState<{ forCount: number; againstCount: number; abstainCount: number; newStatus: string | null } | null>(null);
  const [castingVote, setCastingVote] = useState(false);

  // Edit & resubmit state
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [editText, setEditText] = useState('');
  const [resubmitting, setResubmitting] = useState(false);

  // Audit trail (revision history)
  const [revisions, setRevisions] = useState<any[]>([]);
  const [expandedRevision, setExpandedRevision] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, c, r, cfg, revs] = await Promise.all([
        api.getProposal(id, user?.walletAddress),
        api.listProposalComments(id, user?.walletAddress),
        api.getReactionCounts(id, user?.walletAddress),
        api.getCoopConfig('soulaan'),
        api.getProposalRevisions(id, user?.walletAddress),
      ]);
      setProposal(p);
      setComments(c?.comments ?? []);
      if (r) setReactionCounts(r);
      if (cfg?.proposalCategories) {
        setCategoryLabels(
          Object.fromEntries(cfg.proposalCategories.map((cat: { key: string; label: string }) => [cat.key, cat.label]))
        );
      }
      setRevisions(revs ?? []);
    } catch {
      // keep existing state on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, user?.walletAddress]);

  useEffect(() => { load(); }, [load]);

  async function postComment() {
    if (!comment.trim() || !user?.walletAddress) return;
    setPosting(true);
    try {
      await api.createProposalComment(id!, comment.trim(), user.walletAddress);
      setComment('');
      const c = await api.listProposalComments(id!, user.walletAddress);
      setComments(c?.comments ?? []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to post comment';
      Alert.alert('Could not post comment', msg);
    } finally {
      setPosting(false);
    }
  }

  async function handleReact(reaction: 'SUPPORT' | 'CONCERN') {
    if (!user?.walletAddress || !id) return;
    setReactingTo(reaction);
    try {
      const result = await api.reactToProposal(id, reaction, user.walletAddress);
      if (result) setReactionCounts(result);
    } catch {
      // ignore
    } finally {
      setReactingTo(null);
    }
  }

  function confirmWithdraw() {
    Alert.alert(
      'Withdraw Proposal',
      'Are you sure you want to withdraw this proposal? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            if (!user?.walletAddress || !id) return;
            setWithdrawing(true);
            try {
              await api.withdrawProposal(id, user.walletAddress);
              await load();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to withdraw proposal');
            } finally {
              setWithdrawing(false);
            }
          },
        },
      ],
    );
  }

  async function handleCouncilVote(vote: 'FOR' | 'AGAINST' | 'ABSTAIN') {
    if (!user?.walletAddress || !id) return;
    setCastingVote(true);
    try {
      const result = await api.councilVote(id, vote, user.walletAddress);
      if (result) {
        setCouncilVoteResult(result);
        if (result.newStatus) {
          await load(); // reload if status changed
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to cast vote');
    } finally {
      setCastingVote(false);
    }
  }

  async function handleResubmit() {
    if (!user?.walletAddress || !id || editText.trim().length < 10) return;
    setResubmitting(true);
    try {
      await api.resubmitProposal(id, editText.trim(), user.walletAddress);
      setShowEditPanel(false);
      await load();
    } catch (e: any) {
      Alert.alert('Resubmit Failed', e.message || 'Could not resubmit proposal');
    } finally {
      setResubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-cream-100 items-center justify-center">
        <ActivityIndicator size="large" color="#B45309" />
      </SafeAreaView>
    );
  }

  if (!proposal) {
    return (
      <SafeAreaView className="flex-1 bg-cream-100 items-center justify-center p-8">
        <Text className="text-charcoal-500 text-center">Proposal not found.</Text>
        <TouchableOpacity onPress={() => router.back()} className="mt-4">
          <Text className="text-gold-700 font-semibold">Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const dc = decisionColor(proposal.decision);
  const overallScore = Math.round((proposal.evaluation?.computed_scores?.overall_score ?? 0) * 100);
  const passesThreshold = proposal.evaluation?.computed_scores?.passes_threshold ?? false;
  const failReasons: string[] = proposal.evaluation?.computed_scores?.passFailReasons ?? [];
  const FAIL_LABELS: Record<string, string> = {
    FAIL_STRUCTURAL_GATE: 'Structural score too low',
    FAIL_MISSION_MIN_THRESHOLD: 'Mission impact score too low',
    FAIL_NO_STRONG_MISSION_GOAL: 'No single goal scored strongly',
  };
  const structuralBreakdown: { factor: string; rationale?: string }[] = proposal.evaluation?.structural_breakdown ?? [];
  const visibleComments = showAll ? comments : comments.slice(0, 3);

  // Proposer + admin role checks
  const isProposer = user?.walletAddress && proposal.proposer?.wallet === user.walletAddress;
  const isAdmin = (user as any)?.roles?.includes('admin') || (user as any)?.role === 'admin';
  const canWithdraw = isProposer && (proposal.status === 'submitted' || proposal.status === 'votable');
  const canEdit = isProposer && (proposal.status === 'submitted' || proposal.status === 'votable');
  const councilRequired = proposal.councilRequired;

  // Build a dynamic process timeline that reflects actual routing logic:
  //   • AI scoring is synchronous — proposal never sits in "pending" unless engine returned revise
  //   • advance + budget < threshold  → auto-approved (no council)
  //   • advance + budget >= threshold → council vote required
  //   • block / revise               → proposal closed at AI stage
  const processSteps = (() => {
    const st = proposal.status as string;
    const aiAdvanced = proposal.decision === 'advance';
    const isTerminal = ['rejected', 'failed', 'withdrawn'].includes(st);
    const isApproved = st === 'approved' || st === 'funded';
    const isVotable  = st === 'votable';
    const isFunded   = st === 'funded';
    const isSubmitted = st === 'submitted';

    type Step = { icon: React.ReactNode; bg: string; label: string; detail: string; done: boolean };
    const steps: Step[] = [];

    // ── Step 1: Submitted (always complete) ─────────────────────────────────
    steps.push({
      icon: <CheckCircle size={18} color="#16A34A" />,
      bg: '#DCFCE7',
      label: 'Proposal Submitted',
      detail: formatDate(proposal.createdAt),
      done: true,
    });

    // ── Step 2: AI Scoring ──────────────────────────────────────────────────
    if (isSubmitted) {
      // Engine returned "revise" — needs more information before it can advance
      steps.push({
        icon: <Clock size={18} color="#B45309" />,
        bg: '#FEF3C7',
        label: 'AI Scoring',
        detail: 'Checking alignment with commons goals & charter',
        done: false,
      });
      return steps;
    }

    const decisionTag = aiAdvanced
      ? 'Advanced'
      : proposal.decision === 'block' ? 'Not aligned' : 'Needs revision';
    steps.push({
      icon: <Sparkles size={18} color={aiAdvanced ? '#16A34A' : '#DC2626'} />,
      bg: aiAdvanced ? '#DCFCE7' : '#FEF2F2',
      label: 'AI Scoring Complete',
      detail: `Score: ${overallScore}% · ${decisionTag}`,
      done: aiAdvanced,
    });

    // ── AI did not advance → proposal is closed ─────────────────────────────
    if (!aiAdvanced) {
      steps.push({
        icon: <XCircle size={18} color="#DC2626" />,
        bg: '#FEF2F2',
        label: 'Proposal Closed',
        detail: proposal.decision === 'block'
          ? 'Not aligned with commons goals — see AI notes below'
          : 'Requires significant revision — see AI notes below',
        done: true,
      });
      return steps;
    }

    // ── AI advanced ─────────────────────────────────────────────────────────
    if (councilRequired) {
      // Large-budget path — council vote required

      steps.push({
        icon: <MessageCircle size={18} color={isVotable ? '#2563EB' : isApproved ? '#16A34A' : '#9CA3AF'} />,
        bg: isVotable ? '#DBEAFE' : isApproved ? '#DCFCE7' : '#F3F4F6',
        label: 'Community Input',
        detail: isVotable
          ? 'Members can react & comment — council reviews sentiment'
          : isApproved ? 'Input received by council'
          : isTerminal ? 'Closed before vote'
          : 'Pending',
        done: isApproved || isTerminal,
      });

      if (isTerminal) {
        steps.push({
          icon: <XCircle size={18} color={st === 'withdrawn' ? '#6B7280' : '#DC2626'} />,
          bg: st === 'withdrawn' ? '#F3F4F6' : '#FEF2F2',
          label: st === 'withdrawn' ? 'Withdrawn' : 'Rejected by Council',
          detail: st === 'withdrawn' ? 'Withdrawn by proposer' : 'Council voted to reject',
          done: true,
        });
        return steps;
      }

      steps.push({
        icon: <Shield size={18} color={isVotable ? '#7C3AED' : '#16A34A'} />,
        bg: isVotable ? '#F5F3FF' : '#DCFCE7',
        label: isVotable ? 'Council Vote (open)' : 'Council Approved',
        detail: isVotable
          ? 'Council members casting votes — majority decides'
          : 'Approved by council ✓',
        done: isApproved,
      });
    } else {
      // Tier 1: AI auto-approved — budget below auto-approve threshold
      steps.push({
        icon: <CheckCircle size={18} color="#16A34A" />,
        bg: '#DCFCE7',
        label: 'AI Auto-Approved',
        detail: 'Budget below auto-approve threshold — no council vote required',
        done: true,
      });

      if (isTerminal) {
        steps.push({
          icon: <XCircle size={18} color="#6B7280" />,
          bg: '#F3F4F6',
          label: 'Withdrawn',
          detail: 'Withdrawn by proposer after approval',
          done: true,
        });
        return steps;
      }
    }

    // ── Final: Funding ───────────────────────────────────────────────────────
    steps.push({
      icon: <TrendingUp size={18} color={isFunded ? '#16A34A' : '#9CA3AF'} />,
      bg: isFunded ? '#DCFCE7' : '#F3F4F6',
      label: 'Funding',
      detail: isFunded ? 'Funds disbursed ✓' : 'Pending disbursement',
      done: isFunded,
    });

    return steps;
  })();

  return (
    <SafeAreaView className="flex-1 bg-cream-100">
      {/* Sticky header */}
      <View className="bg-red-800 px-4 py-3 flex-row items-center gap-3">
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ArrowLeft size={22} color="#fff" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-white font-bold text-base" numberOfLines={1}>Proposal Details</Text>
          <Text className="text-red-200 text-xs">{statusLabel(proposal.status)}</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#B45309" />}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Proposal header ── */}
          <View className="bg-white rounded-2xl p-4" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
            {/* Badges row */}
            <View className="flex-row flex-wrap gap-2 mb-3">
              <View className="bg-gold-100 rounded-full px-3 py-1">
                <Text className="text-gold-700 text-xs font-semibold">{categoryLabels[proposal.category] ?? prettifyKey(proposal.category)}</Text>
              </View>
              <View className="rounded-full px-3 py-1" style={{ backgroundColor: dc.bg, borderColor: dc.border, borderWidth: 1 }}>
                <Text style={{ color: dc.text, fontSize: 12, fontWeight: '600' }}>
                  {dc.label}
                </Text>
              </View>
              <View className="bg-blue-50 border border-blue-200 rounded-full px-3 py-1">
                <Text className="text-blue-600 text-xs font-medium">{statusLabel(proposal.status)}</Text>
              </View>
            </View>

            <Text className="text-charcoal-800 font-bold text-xl leading-tight mb-2">{proposal.title}</Text>
            <Text className="text-charcoal-600 text-sm leading-relaxed mb-3">{proposal.summary}</Text>

            {/* Proposer info */}
            <View className="bg-cream-50 rounded-xl p-3 flex-row items-center gap-3">
              <View className="w-10 h-10 rounded-full bg-gold-600 items-center justify-center">
                <Text className="text-white font-bold text-sm">
                  {(proposal.proposer?.displayName ?? proposal.proposer?.wallet ?? '??').slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-charcoal-800 font-medium text-sm">
                  {proposal.proposer?.displayName || walletShort(proposal.proposer?.wallet)}
                </Text>
                <Text className="text-charcoal-400 text-xs capitalize">{proposal.proposer?.role}</Text>
              </View>
              <View className="items-end">
                <Text className="text-charcoal-400 text-xs">Submitted</Text>
                <Text className="text-charcoal-700 text-xs font-medium">{formatDate(proposal.createdAt)}</Text>
              </View>
            </View>
          </View>

          {/* ── Decision banner (if not advance) ── */}
          {proposal.decisionReasons?.length > 0 && (
            <View className="rounded-2xl p-4 border" style={{ backgroundColor: dc.bg, borderColor: dc.border }}>
              <Text style={{ color: dc.text, fontWeight: '700', fontSize: 14, marginBottom: 6 }}>
                Decision: {dc.label}
              </Text>
              {proposal.decisionReasons.map((r: string, i: number) => (
                <View key={i} className="flex-row items-start gap-2 mb-1">
                  <Text style={{ color: dc.text, marginTop: 2 }}>•</Text>
                  <Text style={{ color: dc.text, fontSize: 13, flex: 1, lineHeight: 20 }}>{r}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Edit & Resubmit (proposer only, submitted/votable) ── */}
          {canEdit && (
            <View className="bg-white rounded-2xl overflow-hidden" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
              <TouchableOpacity
                className="p-4 flex-row items-center gap-3"
                style={{ backgroundColor: '#FFFBEB' }}
                onPress={() => {
                  if (!showEditPanel) setEditText(proposal.rawText ?? proposal.summary ?? '');
                  setShowEditPanel(v => !v);
                }}
              >
                <View className="w-9 h-9 rounded-full bg-amber-100 items-center justify-center">
                  <Pencil size={16} color="#B45309" />
                </View>
                <View className="flex-1">
                  <Text className="text-amber-800 font-semibold text-sm">Edit & Resubmit</Text>
                  <Text className="text-amber-600 text-xs">Update your proposal text and let the AI re-evaluate</Text>
                </View>
                {showEditPanel
                  ? <ChevronUp size={16} color="#B45309" />
                  : <ChevronDown size={16} color="#B45309" />
                }
              </TouchableOpacity>

              {showEditPanel && (
                <View className="p-4 pt-0 gap-3">
                  <TextInput
                    value={editText}
                    onChangeText={setEditText}
                    multiline
                    numberOfLines={8}
                    placeholder="Update your proposal text..."
                    placeholderTextColor="#9CA3AF"
                    style={{
                      borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12,
                      padding: 12, minHeight: 160, textAlignVertical: 'top',
                      fontSize: 13, color: '#1F2937', backgroundColor: '#F9FAFB',
                    }}
                  />
                  <Text className="text-charcoal-400 text-xs text-right">{editText.length} chars</Text>
                  <TouchableOpacity
                    onPress={handleResubmit}
                    disabled={resubmitting || editText.trim().length < 10}
                    className="rounded-xl py-3 flex-row items-center justify-center gap-2"
                    style={{ backgroundColor: resubmitting || editText.trim().length < 10 ? '#D1D5DB' : '#B45309' }}
                  >
                    {resubmitting
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <RotateCcw size={14} color="#fff" />
                    }
                    <Text className="text-white font-semibold text-sm">
                      {resubmitting ? 'Re-evaluating…' : 'Resubmit for Review'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* ── Budget & Funding ── */}
          <View className="bg-white rounded-2xl p-4" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
            <Text className="text-charcoal-800 font-semibold text-base mb-3">Budget & Details</Text>
            <View className="gap-2">
              {[
                ['Budget Requested', `${proposal.budget?.currency ?? ''} ${proposal.budget?.amountRequested?.toLocaleString() ?? 0}`],
                ['Category', categoryLabels[proposal.category] ?? prettifyKey(proposal.category)],
                ['Location', proposal.region?.name],
              ].map(([label, value]) => (
                <View key={label} className="flex-row justify-between items-center p-3 bg-cream-50 rounded-xl">
                  <Text className="text-charcoal-500 text-sm">{label}</Text>
                  <Text className="text-charcoal-800 font-medium text-sm">{value}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── AI Review ── */}
          <View className="bg-white rounded-2xl overflow-hidden" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
            {/* Header */}
            <View className="p-4 flex-row items-center gap-3" style={{ backgroundColor: '#F0FDF4' }}>
              <View className="w-10 h-10 rounded-full bg-green-100 items-center justify-center">
                <Sparkles size={20} color="#16A34A" />
              </View>
              <View className="flex-1">
                <Text className="text-green-800 font-semibold text-base">AI Review Results</Text>
                <Text className="text-green-600 text-xs">Engine v{proposal.audit?.engineVersion}</Text>
              </View>
              <View className="items-end">
                <Text className="text-green-700 font-bold text-2xl">{overallScore}</Text>
                <Text className="text-green-600 text-xs">/ 100</Text>
              </View>
            </View>

            <View className="p-4 gap-1">
              {/* Pass/fail badge(s) */}
              <View className="flex-row flex-wrap gap-1 mb-2">
                {passesThreshold ? (
                  <View className="self-start rounded-full px-3 py-1 flex-row items-center gap-1" style={{ backgroundColor: '#DCFCE7' }}>
                    <CheckCircle size={12} color="#16A34A" />
                    <Text style={{ color: '#16A34A', fontSize: 11, fontWeight: '600' }}>Passed</Text>
                  </View>
                ) : failReasons.length > 0 ? (
                  failReasons.map(r => (
                    <View key={r} className="self-start rounded-full px-3 py-1 flex-row items-center gap-1" style={{ backgroundColor: '#FEF2F2' }}>
                      <XCircle size={12} color="#DC2626" />
                      <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: '600' }}>{FAIL_LABELS[r] ?? r}</Text>
                    </View>
                  ))
                ) : (
                  <View className="self-start rounded-full px-3 py-1 flex-row items-center gap-1" style={{ backgroundColor: '#FEF2F2' }}>
                    <XCircle size={12} color="#DC2626" />
                    <Text style={{ color: '#DC2626', fontSize: 11, fontWeight: '600' }}>Below Threshold</Text>
                  </View>
                )}
              </View>

              {/* LLM Summary */}
              {proposal.evaluation?.llm_summary ? (
                <Text className="text-charcoal-500 text-xs leading-relaxed mb-3">
                  {proposal.evaluation.llm_summary}
                </Text>
              ) : null}

              {/* Structural Scores */}
              {proposal.evaluation?.structural_scores && (
                <View className="mb-3">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-charcoal-700 font-semibold text-sm">Structural</Text>
                    <Text className="text-charcoal-400 text-xs">
                      {Math.round((proposal.evaluation.computed_scores?.structural_weighted_score ?? 0) * 100)}% weighted
                    </Text>
                  </View>
                  {/* Goal mapping valid */}
                  <View className="flex-row items-center gap-2 mb-2">
                    {proposal.evaluation.structural_scores.goal_mapping_valid
                      ? <CheckCircle size={14} color="#16A34A" />
                      : <XCircle size={14} color="#DC2626" />
                    }
                    <Text style={{ color: proposal.evaluation.structural_scores.goal_mapping_valid ? '#16A34A' : '#DC2626', fontSize: 12 }}>
                      Goal mapping {proposal.evaluation.structural_scores.goal_mapping_valid ? 'valid' : 'invalid'}
                    </Text>
                  </View>
                  <ScoreBar label="Feasibility" value={proposal.evaluation.structural_scores.feasibility_score} icon={<CheckCircle size={13} color="#B45309" />} />
                  {structuralBreakdown.find(b => b.factor === 'feasibility')?.rationale ? (
                    <Text className="text-charcoal-400 text-xs ml-5 -mt-1 mb-1 italic">{structuralBreakdown.find(b => b.factor === 'feasibility')!.rationale}</Text>
                  ) : null}
                  <ScoreBar label="Risk" value={proposal.evaluation.structural_scores.risk_score} icon={<Shield size={13} color="#B45309" />} />
                  <Text className="text-charcoal-400 text-xs ml-5 -mt-1 mb-0.5">Lower risk is better</Text>
                  {structuralBreakdown.find(b => b.factor === 'risk')?.rationale ? (
                    <Text className="text-charcoal-400 text-xs ml-5 mb-1 italic">{structuralBreakdown.find(b => b.factor === 'risk')!.rationale}</Text>
                  ) : null}
                  <ScoreBar label="Accountability" value={proposal.evaluation.structural_scores.accountability_score} icon={<Users size={13} color="#B45309" />} />
                  {structuralBreakdown.find(b => b.factor === 'accountability')?.rationale ? (
                    <Text className="text-charcoal-400 text-xs ml-5 -mt-1 mb-1 italic">{structuralBreakdown.find(b => b.factor === 'accountability')!.rationale}</Text>
                  ) : null}
                </View>
              )}

              {/* Mission Impact Scores */}
              {proposal.evaluation?.mission_impact_scores && proposal.evaluation.mission_impact_scores.length > 0 && (
                <View className="mt-1 pt-3 border-t border-cream-200">
                  <View className="flex-row items-center justify-between mb-2">
                    <Text className="text-charcoal-700 font-semibold text-sm">Mission Impact</Text>
                    <Text className="text-charcoal-400 text-xs">
                      {Math.round((proposal.evaluation.computed_scores?.mission_weighted_score ?? 0) * 100)}% weighted
                    </Text>
                  </View>
                  {proposal.evaluation.mission_impact_scores.map((s: any) => (
                    <View key={s.goal_id}>
                      <ScoreBar
                        label={s.goal_id.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        value={s.impact_score}
                        icon={<TrendingUp size={11} color="#B45309" />}
                      />
                      <Text className="text-charcoal-400 text-xs ml-5 -mt-1 mb-0.5">
                        {Math.round(s.goal_priority_weight * 100)}% priority weight
                      </Text>
                      {s.score_reason ? (
                        <Text className="text-charcoal-400 text-xs ml-5 mb-1 italic">{s.score_reason}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}

              {/* Risk Flags */}
              {proposal.evaluation?.risk_flags && proposal.evaluation.risk_flags.length > 0 && (
                <View className="mt-3 pt-3 border-t border-cream-200">
                  <Text className="text-amber-700 font-semibold text-sm mb-2">Risk Flags</Text>
                  {proposal.evaluation.risk_flags.map((flag: string, i: number) => (
                    <View key={i} className="flex-row gap-2 mb-1">
                      <AlertCircle size={13} color="#B45309" style={{ marginTop: 1 }} />
                      <Text className="text-charcoal-600 text-xs flex-1">{flag}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Violations */}
              {proposal.evaluation?.violations && proposal.evaluation.violations.length > 0 && (
                <View className="mt-3 pt-3 border-t border-cream-200">
                  <Text className="text-red-600 font-semibold text-sm mb-2">Violations</Text>
                  {proposal.evaluation.violations.map((v: string, i: number) => (
                    <View key={i} className="flex-row gap-2 mb-1">
                      <XCircle size={13} color="#DC2626" style={{ marginTop: 1 }} />
                      <Text className="text-charcoal-600 text-xs flex-1">{v}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Audit checks */}
              {proposal.audit?.checks?.length > 0 && (
                <View className="mt-3 pt-3 border-t border-cream-200">
                  <Text className="text-charcoal-700 font-semibold text-sm mb-2">Compliance Checks</Text>
                  {proposal.audit.checks.map((check: any, i: number) => (
                    <View key={i} className="flex-row items-center gap-2 mb-1.5">
                      {check.passed
                        ? <CheckCircle size={14} color="#16A34A" />
                        : <XCircle size={14} color="#DC2626" />
                      }
                      <Text className="text-charcoal-600 text-xs flex-1">{check.name.replace(/_/g, ' ')}</Text>
                      {check.note && <Text className="text-charcoal-400 text-xs">({check.note})</Text>}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>

          {/* ── Alternatives ── */}
          {proposal.alternatives?.length > 0 && (
            <View className="bg-white rounded-2xl p-4" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
              <Text className="text-charcoal-800 font-semibold text-base mb-3">AI Alternatives</Text>
              {proposal.bestAlternative && (
                <View className="p-3 rounded-xl border border-amber-300 bg-amber-50 mb-3">
                  <Text className="text-amber-600 font-semibold text-xs mb-1">⭐ Recommended Alternative</Text>
                  <Text className="text-charcoal-800 font-medium text-sm">{proposal.bestAlternative.label}</Text>
                  <Text className="text-charcoal-500 text-xs mt-1 leading-relaxed">{proposal.bestAlternative.rationale}</Text>
                </View>
              )}
              {proposal.alternatives.map((alt: any, i: number) => (
                <View key={i} className="p-3 rounded-xl bg-cream-50 border border-cream-200 mb-2">
                  <Text className="text-charcoal-800 font-medium text-sm">{alt.label}</Text>
                  <Text className="text-charcoal-500 text-xs mt-1 leading-relaxed">{alt.rationale}</Text>
                  {alt.overallScore != null && (
                    <Text className="text-amber-600 text-xs mt-1 font-semibold">
                      Overall Score: {Math.round((alt.overallScore ?? 0) * 100)}%
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* ── Missing data ── */}
          {proposal.missing_data?.length > 0 && (
            <View className="bg-white rounded-2xl p-4" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
              <Text className="text-charcoal-800 font-semibold text-base mb-3">Missing Data</Text>
              {proposal.missing_data.map((item: any, i: number) => {
                const sev: string = item.severity ?? (item.blocking ? 'BLOCKER' : 'SOFT');
                const isBlocker = sev === 'BLOCKER';
                const isInfo = sev === 'INFO';
                const iconColor = isBlocker ? '#DC2626' : isInfo ? '#2563EB' : '#B45309';
                const bgColor = isBlocker ? '#FEF2F2' : isInfo ? '#EFF6FF' : '#FFFBEB';
                const textColor = isBlocker ? '#DC2626' : isInfo ? '#2563EB' : '#B45309';
                return (
                  <View key={i} className="flex-row gap-2 mb-3">
                    <AlertCircle size={16} color={iconColor} style={{ marginTop: 1 }} />
                    <View className="flex-1">
                      <Text className="text-charcoal-800 text-sm font-medium">{item.field}</Text>
                      <Text className="text-charcoal-500 text-xs mt-0.5">{item.question}</Text>
                      <Text className="text-charcoal-400 text-xs">{item.why_needed}</Text>
                      <View className="flex-row flex-wrap items-center gap-1 mt-1">
                        <View className="self-start rounded-full px-2 py-0.5" style={{ backgroundColor: bgColor }}>
                          <Text style={{ color: textColor, fontSize: 10, fontWeight: '600' }}>{sev}</Text>
                        </View>
                        {item.affectedGoalIds?.length > 0 && (
                          <Text style={{ fontSize: 10, color: '#9CA3AF' }}>
                            affects: {item.affectedGoalIds.join(', ')}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* ── Withdraw button (proposer only, submitted/votable) ── */}
          {canWithdraw && (
            <View className="bg-white rounded-2xl p-4" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
              <TouchableOpacity
                onPress={confirmWithdraw}
                disabled={withdrawing}
                className="flex-row items-center justify-center gap-2 border-2 rounded-xl py-3"
                style={{ borderColor: '#EF4444', backgroundColor: withdrawing ? '#FEF2F2' : '#fff', opacity: withdrawing ? 0.6 : 1 }}
              >
                {withdrawing
                  ? <ActivityIndicator size="small" color="#DC2626" />
                  : <LogOut size={16} color="#DC2626" />
                }
                <Text style={{ color: '#DC2626', fontWeight: '600', fontSize: 14 }}>
                  {withdrawing ? 'Withdrawing…' : 'Withdraw Proposal'}
                </Text>
              </TouchableOpacity>
              <Text className="text-charcoal-400 text-xs text-center mt-2">
                Only you (the proposer) can withdraw this proposal.
              </Text>
            </View>
          )}

          {/* ── Council Vote Panel (admin + councilRequired + votable) ── */}
          {isAdmin && councilRequired && proposal.status === 'votable' && (
            <View className="rounded-2xl p-4 border-2" style={{ borderColor: '#A855F7', backgroundColor: '#FAF5FF' }}>
              <View className="flex-row items-center gap-2 mb-3">
                <Shield size={18} color="#7C3AED" />
                <Text className="text-purple-800 font-bold text-base">Council Vote Required</Text>
              </View>
              <Text className="text-purple-600 text-sm mb-3 leading-relaxed">
                This proposal exceeds the council review threshold. Cast your vote below.
              </Text>
              <View className="flex-row gap-2 mb-3">
                {(['FOR', 'AGAINST', 'ABSTAIN'] as const).map(v => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => handleCouncilVote(v)}
                    disabled={castingVote}
                    className="flex-1 rounded-xl py-2.5 items-center border"
                    style={{
                      backgroundColor: v === 'FOR' ? '#F0FDF4' : v === 'AGAINST' ? '#FEF2F2' : '#F9FAFB',
                      borderColor: v === 'FOR' ? '#86EFAC' : v === 'AGAINST' ? '#FCA5A5' : '#E5E7EB',
                      opacity: castingVote ? 0.6 : 1,
                    }}
                  >
                    {castingVote ? <ActivityIndicator size="small" color="#7C3AED" /> : null}
                    <Text style={{ color: v === 'FOR' ? '#15803D' : v === 'AGAINST' ? '#DC2626' : '#6B7280', fontWeight: '700', fontSize: 12 }}>
                      {v}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {councilVoteResult && (
                <View className="bg-white rounded-xl p-3 border border-purple-200">
                  <Text className="text-charcoal-700 text-xs font-semibold mb-1">Current Tally</Text>
                  <Text className="text-charcoal-600 text-xs">
                    {councilVoteResult.forCount} FOR · {councilVoteResult.againstCount} AGAINST · {councilVoteResult.abstainCount} ABSTAIN
                  </Text>
                  {councilVoteResult.newStatus && (
                    <Text className="text-purple-700 text-xs font-semibold mt-1">
                      → Status updated to {councilVoteResult.newStatus.toUpperCase()}
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}

          {/* ── Community reactions ── */}
          <View className="bg-white rounded-2xl p-4" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
            <View className="flex-row items-center justify-between mb-3">
              <View>
                <Text className="text-charcoal-800 font-semibold text-base">Community Reactions</Text>
                <Text className="text-charcoal-400 text-xs mt-0.5">Let the council know how members feel</Text>
              </View>
              {proposal.status === 'votable' && (
                <View className="bg-blue-100 rounded-full px-3 py-1 flex-row items-center gap-1">
                  <Clock size={12} color="#2563EB" />
                  <Text className="text-blue-700 text-xs font-semibold">Open</Text>
                </View>
              )}
            </View>
            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => handleReact('SUPPORT')}
                disabled={!user?.walletAddress || reactingTo !== null}
                className="flex-1 rounded-xl border-2 p-4 items-center"
                style={{
                  borderColor: reactionCounts.myReaction === 'SUPPORT' ? '#16A34A' : '#E9E0D0',
                  backgroundColor: reactionCounts.myReaction === 'SUPPORT' ? '#F0FDF4' : '#fff',
                  opacity: (!user?.walletAddress || reactingTo !== null) ? 0.5 : 1,
                }}
              >
                {reactingTo === 'SUPPORT' ? <ActivityIndicator size="small" color="#16A34A" /> : <ThumbsUp size={22} color={reactionCounts.myReaction === 'SUPPORT' ? '#16A34A' : '#9CA3AF'} />}
                <Text className="text-charcoal-800 font-bold text-base mt-1">Support</Text>
                <Text className="text-charcoal-500 text-sm font-semibold">{reactionCounts.support}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleReact('CONCERN')}
                disabled={!user?.walletAddress || reactingTo !== null}
                className="flex-1 rounded-xl border-2 p-4 items-center"
                style={{
                  borderColor: reactionCounts.myReaction === 'CONCERN' ? '#B45309' : '#E9E0D0',
                  backgroundColor: reactionCounts.myReaction === 'CONCERN' ? '#FFFBEB' : '#fff',
                  opacity: (!user?.walletAddress || reactingTo !== null) ? 0.5 : 1,
                }}
              >
                {reactingTo === 'CONCERN' ? <ActivityIndicator size="small" color="#B45309" /> : <AlertCircle size={22} color={reactionCounts.myReaction === 'CONCERN' ? '#B45309' : '#9CA3AF'} />}
                <Text className="text-charcoal-800 font-bold text-base mt-1">Concern</Text>
                <Text className="text-charcoal-500 text-sm font-semibold">{reactionCounts.concern}</Text>
              </TouchableOpacity>
            </View>
            {reactionCounts.myReaction && (
              <Text className="text-charcoal-400 text-xs text-center mt-2">
                You marked this as &quot;{reactionCounts.myReaction === 'SUPPORT' ? 'Support' : 'Has Concerns'}&quot; — tap again to remove
              </Text>
            )}
            {!user?.walletAddress && (
              <Text className="text-charcoal-400 text-xs text-center mt-2">
                Connect your wallet to react to this proposal
              </Text>
            )}
          </View>

          {/* ── Full proposal details (collapsible) ── */}
          <View className="bg-white rounded-2xl overflow-hidden" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
            <TouchableOpacity
              onPress={() => setShowFull(v => !v)}
              className="p-4 flex-row items-center justify-between"
            >
              <View className="flex-row items-center gap-2">
                <FileText size={16} color="#B45309" />
                <Text className="text-charcoal-800 font-semibold text-base">Full Proposal Details</Text>
              </View>
              {showFull ? <ChevronUp size={18} color="#6B7280" /> : <ChevronDown size={18} color="#6B7280" />}
            </TouchableOpacity>
            {showFull && (
              <View className="px-4 pb-4">
                {[
                  { label: 'Category', value: categoryLabels[proposal.category] ?? prettifyKey(proposal.category) },
                  { label: 'Location', value: proposal.region?.name },
                  { label: 'Council Required', value: proposal.councilRequired ? 'Yes — pending council vote' : 'No — auto-approved if AI advances' },
                ].map(row => (
                  <View key={row.label} className="mb-3">
                    <Text className="text-charcoal-400 text-xs">{row.label}</Text>
                    <Text className="text-charcoal-700 text-sm mt-0.5">{row.value}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* ── Comments / Discussion ── */}
          <View className="bg-white rounded-2xl p-4" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
            <View className="flex-row items-center justify-between mb-4">
              <View className="flex-row items-center gap-2">
                <MessageCircle size={16} color="#B45309" />
                <Text className="text-charcoal-800 font-semibold text-base">Community Discussion</Text>
              </View>
              <View className="bg-cream-100 rounded-full px-2 py-0.5">
                <Text className="text-charcoal-500 text-xs">{comments.length}</Text>
              </View>
            </View>

            {/* Add comment */}
            {user?.walletAddress ? (
              <View className="bg-cream-50 rounded-xl p-3 mb-4">
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Share your thoughts, questions, or concerns…"
                  placeholderTextColor="#9CA3AF"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  className="text-charcoal-800 text-sm bg-white border border-cream-300 rounded-xl px-3 py-2 mb-2"
                  style={{ minHeight: 72 }}
                  maxLength={5000}
                />
                <View className="flex-row items-center justify-between">
                  <Text className="text-charcoal-400 text-xs">
                    {comment.length > 0 ? `${comment.length}/5000` : 'Visible to all members'}
                  </Text>
                  <TouchableOpacity
                    onPress={postComment}
                    disabled={!comment.trim() || posting}
                    className="bg-red-700 rounded-xl px-4 py-2 flex-row items-center gap-1.5"
                    style={{ opacity: comment.trim() && !posting ? 1 : 0.4 }}
                  >
                    {posting
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Send size={14} color="#fff" />
                    }
                    <Text className="text-white font-semibold text-sm">Post</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View className="bg-cream-50 rounded-xl p-3 mb-4 items-center">
                <Text className="text-charcoal-400 text-sm">Connect your wallet to join the discussion.</Text>
              </View>
            )}

            {/* Comment list */}
            {comments.length === 0 ? (
              <View className="py-6 items-center">
                <MessageCircle size={32} color="#D1D5DB" />
                <Text className="text-charcoal-400 text-sm mt-2">No comments yet. Be the first to weigh in.</Text>
              </View>
            ) : (
              <>
                {visibleComments.map(c => <CommentItem key={c.id} comment={c} />)}
                {comments.length > 3 && (
                  <TouchableOpacity
                    onPress={() => setShowAll(v => !v)}
                    className="flex-row items-center justify-center gap-1 py-2"
                  >
                    {showAll ? <ChevronUp size={16} color="#B45309" /> : <ChevronDown size={16} color="#B45309" />}
                    <Text className="text-gold-700 text-sm font-semibold">
                      {showAll ? 'Show less' : `View all ${comments.length} comments`}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          {/* ── Submission History / Audit Trail ── */}
          {revisions.length > 0 && (
            <View className="bg-white rounded-2xl overflow-hidden" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
              <View className="p-4 flex-row items-center gap-2 border-b border-cream-200">
                <History size={16} color="#B45309" />
                <Text className="text-charcoal-800 font-semibold text-base flex-1">Submission History</Text>
                <Text className="text-charcoal-400 text-xs">{revisions.length} revision{revisions.length !== 1 ? 's' : ''}</Text>
              </View>
              {[...revisions].reverse().map((rev: any) => {
                const isExpanded = expandedRevision === rev.revisionNumber;
                const decBg = rev.decision === 'advance' ? '#F0FDF4' : rev.decision === 'block' ? '#FEF2F2' : '#FFFBEB';
                const decColor = rev.decision === 'advance' ? '#15803D' : rev.decision === 'block' ? '#DC2626' : '#B45309';
                const overallPct = rev.evaluation?.computed_scores?.overall_score != null
                  ? Math.round(rev.evaluation.computed_scores.overall_score * 100)
                  : null;
                return (
                  <View key={rev.revisionNumber} className="border-b border-cream-200 last:border-0">
                    <TouchableOpacity
                      className="px-4 py-3 flex-row items-center gap-3"
                      onPress={() => setExpandedRevision(isExpanded ? null : rev.revisionNumber)}
                    >
                      <Text className="text-charcoal-400 text-xs font-mono w-6">#{rev.revisionNumber}</Text>
                      <View className="rounded-full px-2.5 py-0.5" style={{ backgroundColor: decBg }}>
                        <Text style={{ color: decColor, fontSize: 11, fontWeight: '600' }}>{rev.decision ?? 'unknown'}</Text>
                      </View>
                      <Text className="text-charcoal-400 text-xs flex-1">
                        {new Date(rev.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                      {overallPct != null && (
                        <Text style={{ color: overallPct >= 70 ? '#16A34A' : overallPct >= 40 ? '#B45309' : '#DC2626', fontSize: 12, fontWeight: '700' }}>
                          {overallPct}%
                        </Text>
                      )}
                      {isExpanded ? <ChevronUp size={14} color="#9CA3AF" /> : <ChevronDown size={14} color="#9CA3AF" />}
                    </TouchableOpacity>

                    {isExpanded && (
                      <View className="px-4 pb-4 gap-3 bg-cream-50">
                        {rev.decisionReasons?.length > 0 && (
                          <View>
                            <Text className="text-charcoal-500 text-xs font-semibold uppercase tracking-wide mb-1">Decision Reasons</Text>
                            {rev.decisionReasons.map((r: string, i: number) => (
                              <View key={i} className="flex-row items-start gap-1.5 mb-1">
                                <Text className="text-amber-600 mt-0.5">•</Text>
                                <Text className="text-charcoal-600 text-xs flex-1">{r}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                        {rev.auditChecks?.length > 0 && (
                          <View>
                            <Text className="text-charcoal-500 text-xs font-semibold uppercase tracking-wide mb-1">Compliance Checks</Text>
                            {rev.auditChecks.map((check: any, i: number) => (
                              <View key={i} className="flex-row items-center gap-2 mb-1">
                                {check.passed
                                  ? <CheckCircle size={12} color="#16A34A" />
                                  : <XCircle size={12} color="#DC2626" />
                                }
                                <Text className="text-charcoal-500 text-xs">{check.name?.replace(/_/g, ' ')}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                        {rev.evaluation?.llm_summary && (
                          <View>
                            <Text className="text-charcoal-500 text-xs font-semibold uppercase tracking-wide mb-1">AI Summary</Text>
                            <Text className="text-charcoal-500 text-xs italic">{rev.evaluation.llm_summary}</Text>
                          </View>
                        )}
                        <Text className="text-charcoal-400 text-xs">Engine: {rev.engineVersion}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* ── Process timeline ── */}
          <View className="bg-white rounded-2xl p-4" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
            <Text className="text-charcoal-800 font-semibold text-base mb-4">Proposal Process</Text>
            {processSteps.map((step, i, arr) => (
              <View key={i} className="flex-row gap-3">
                <View className="items-center">
                  <View className="w-9 h-9 rounded-full items-center justify-center" style={{ backgroundColor: step.bg }}>
                    {step.icon}
                  </View>
                  {i < arr.length - 1 && (
                    <View className="w-0.5 flex-1 mt-1 mb-1" style={{ backgroundColor: step.done ? '#DCFCE7' : '#E5E7EB' }} />
                  )}
                </View>
                <View className="flex-1 pb-4">
                  <Text className="text-charcoal-800 font-medium text-sm">{step.label}</Text>
                  <Text className="text-charcoal-400 text-xs mt-0.5">{step.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
