import React, { useState, useCallback, useEffect } from 'react';
import {
  ScrollView,
  View,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Plus,
  CheckCircle,
  MessageCircle,
  Sparkles,
  XCircle,
  ArrowLeft,
  ArrowRight,
  X,
  FileText,
  AlertCircle,
  Lightbulb,
  DollarSign,
  Clock,
  Lock,
} from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { coopConfig } from '@/lib/coop-config';
import { resolveBrandColor, withAlpha } from '@/lib/brand-colors';

// ── Colors ───────────────────────────────────────────────────────────────────

const C = {
  red700: '#B91C1C',
  red800: '#991B1B',
  gold50: '#FFFBEB',
  gold100: '#FEF3C7',
  gold200: '#FDE68A',
  gold600: '#D97706',
  gold700: '#B45309',
  gold800: '#92400E',
  green50: '#F0FDF4',
  green100: '#DCFCE7',
  green600: '#16A34A',
  green700: '#15803D',
  green800: '#166534',
  blue50: '#EFF6FF',
  blue100: '#DBEAFE',
  blue600: '#2563EB',
  blue700: '#1D4ED8',
  amber50: '#FFFBEB',
  amber700: '#B45309',
  red50: '#FEF2F2',
  red200: '#FECACA',
  redText: '#DC2626',
  cream50: '#FAF8F5',
  cream100: '#F5F0EB',
  cream200: '#E9E0D0',
  cream300: '#DDD2BF',
  charcoal400: '#9CA3AF',
  charcoal500: '#6B7280',
  charcoal600: '#4B5563',
  charcoal700: '#374151',
  charcoal800: '#1F2937',
  white: '#FFFFFF',
  whiteA20: 'rgba(255,255,255,0.2)',
  whiteA30: 'rgba(255,255,255,0.3)',
} as const;

// ── Status helpers ───────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: 'submitted', label: 'AI Review' },
  { key: 'votable', label: 'Deliberation' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'withdrawn', label: 'Withdrawn' },
  { key: 'mine', label: 'Mine' },
] as const;

type TabKey = (typeof STATUS_TABS)[number]['key'];

function statusColor(status: string) {
  switch (status) {
    case 'submitted':  return { bg: C.blue50, text: C.blue700, border: '#93C5FD' };
    case 'votable':    return { bg: C.green50, text: C.green600, border: '#86EFAC' };
    case 'approved':   return { bg: C.green50, text: C.green800, border: '#4ADE80' };
    case 'funded':     return { bg: '#FAF5FF', text: '#7C3AED', border: '#C4B5FD' };
    case 'rejected':
    case 'failed':     return { bg: C.red50, text: C.redText, border: '#FCA5A5' };
    case 'withdrawn':  return { bg: '#F9FAFB', text: C.charcoal500, border: '#D1D5DB' };
    default:           return { bg: '#F9FAFB', text: C.charcoal500, border: '#D1D5DB' };
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'submitted':  return 'AI Review';
    case 'votable':    return 'Deliberation';
    case 'approved':   return 'Approved';
    case 'funded':     return 'Funded';
    case 'rejected':   return 'Rejected';
    case 'failed':     return 'Failed';
    case 'withdrawn':  return 'Withdrawn';
    default:           return status;
  }
}

function decisionStyle(decision: string | null | undefined) {
  if (!decision) return null;
  switch (decision) {
    case 'advance': return { label: 'Advance', bg: C.green50, text: C.green800 };
    case 'block':   return { label: 'Block', bg: C.red50, text: C.redText };
    case 'revise':  return { label: 'Revise', bg: C.amber50, text: C.amber700 };
    default:        return null;
  }
}

function timeAgo(dateString: string) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProposalSummary {
  id: string;
  title: string;
  summary: string;
  status: string;
  category: string;
  decision?: string | null;
  evaluation?: { computed_scores?: { overall_score?: number } } | null;
  proposer?: { displayName?: string | null; wallet?: string | null } | null;
  region?: { name?: string | null } | null;
  commentCount?: number;
  createdAt: string;
}

// ── Proposal card ────────────────────────────────────────────────────────────

function ProposalCard({ proposal, accentColor }: { proposal: ProposalSummary; accentColor: string }) {
  const sc = statusColor(proposal.status);
  const score = Math.round((proposal.evaluation?.computed_scores?.overall_score ?? 0) * 100);
  const db = decisionStyle(proposal.decision);

  return (
    <TouchableOpacity
      onPress={() => router.push(`/(authenticated)/proposal-detail?id=${proposal.id}`)}
      activeOpacity={0.7}
      style={styles.card}
    >
      <View style={{ padding: 16 }}>
        {/* Title row */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <Text style={{ color: C.charcoal800, fontWeight: '600', fontSize: 14, flex: 1, lineHeight: 20 }} numberOfLines={2}>
            {proposal.title}
          </Text>
          <View style={{ backgroundColor: sc.bg, borderColor: sc.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text style={{ color: sc.text, fontSize: 11, fontWeight: '600' }}>{statusLabel(proposal.status)}</Text>
          </View>
        </View>

        {/* Summary */}
        <Text style={{ color: C.charcoal500, fontSize: 13, lineHeight: 19, marginBottom: 12 }} numberOfLines={2}>
          {proposal.summary}
        </Text>

        {/* Footer: category + decision + score */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <View style={{ backgroundColor: withAlpha(accentColor, '1A', C.gold100), borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: accentColor, fontSize: 11, fontWeight: '600' }}>{proposal.category}</Text>
            </View>
            {db && (
              <View style={{ backgroundColor: db.bg, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: db.text, fontSize: 10, fontWeight: '700' }}>{db.label}</Text>
              </View>
            )}
          </View>
          {score > 0 && (
            <Text style={{ color: accentColor, fontSize: 14, fontWeight: '700' }}>{score}%</Text>
          )}
        </View>

        {/* Proposer info */}
        <Text style={{ color: C.charcoal400, fontSize: 11, marginTop: 8 }}>
          {proposal.proposer?.displayName || `${proposal.proposer?.wallet?.slice(0, 8)}...`} · {proposal.region?.name} · {timeAgo(proposal.createdAt)}
        </Text>
      </View>

      {/* Status banners */}
      {proposal.status === 'submitted' && (
        <View style={{ backgroundColor: C.blue50, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.blue100, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Sparkles size={13} color={C.blue600} />
          <Text style={{ color: C.blue700, fontSize: 12 }}>AI is reviewing this proposal</Text>
        </View>
      )}

      {proposal.status === 'votable' && (
        <View style={{ backgroundColor: C.green50, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.green100, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <CheckCircle size={13} color={C.green600} />
            <Text style={{ color: C.green700, fontSize: 12, fontWeight: '600' }}>AI Approved · Open for Discussion</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MessageCircle size={12} color={C.charcoal400} />
            <Text style={{ color: C.charcoal400, fontSize: 12 }}>{proposal.commentCount}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ tab, accentColor }: { tab: TabKey; accentColor: string }) {
  const icons: Record<TabKey, React.ReactNode> = {
    submitted:  <Sparkles size={48} color={accentColor} />,
    votable:    <MessageCircle size={48} color={accentColor} />,
    approved:   <CheckCircle size={48} color={C.green600} />,
    rejected:   <XCircle size={48} color={C.charcoal400} />,
    withdrawn:  <XCircle size={48} color={C.charcoal500} />,
    mine:       <FileText size={48} color={accentColor} />,
  };
  const msgs: Record<TabKey, { title: string; sub: string }> = {
    submitted:  { title: 'No proposals under AI review', sub: 'New proposals will appear here while being reviewed.' },
    votable:    { title: 'No proposals in deliberation', sub: 'Proposals approved by AI will move here for community discussion.' },
    approved:   { title: 'No approved proposals yet', sub: 'Proposals that pass deliberation will appear here.' },
    rejected:   { title: 'No rejected proposals', sub: "Proposals that don't pass review or deliberation will appear here." },
    withdrawn:  { title: 'No withdrawn proposals', sub: 'Proposals withdrawn by their authors will appear here.' },
    mine:       { title: "You haven't submitted any proposals yet", sub: 'Tap "Submit" to create your first proposal.' },
  };
  const m = msgs[tab];

  return (
    <View style={{ alignItems: 'center', paddingVertical: 64 }}>
      {icons[tab]}
      <Text style={{ color: C.charcoal700, fontWeight: '600', fontSize: 15, marginTop: 16, marginBottom: 4 }}>{m.title}</Text>
      <Text style={{ color: C.charcoal400, fontSize: 13, textAlign: 'center', paddingHorizontal: 32 }}>{m.sub}</Text>
    </View>
  );
}

// ── Submit modal ─────────────────────────────────────────────────────────────

interface Category {
  id: string;
  label: string;
  description: string;
}

type CategoryId = string;

const BUDGET_RANGES = [
  { min: 0,    max: 500,   label: '$0 - $500'   },
  { min: 500,  max: 5000,  label: '$500 - $5K'  },
  { min: 5000, max: 20000, label: '$5K - $20K'  },
  { min: 20000, max: Infinity, label: '$20K+'   },
];

const TIMELINES = ['1-3 months', '3-6 months', '6-12 months', '12+ months', 'Ongoing'];

interface FormData {
  title: string;
  category: CategoryId | '';
  location: string;
  summary: string;
  problem: string;
  solution: string;
  impact: string;
  budget: string;
  timeline: string;
  milestones: string;
  team: string;
  communityBenefit: string;
}

const EMPTY_FORM: FormData = {
  title: '', category: '', location: '', summary: '', problem: '', solution: '',
  impact: '', budget: '', timeline: '', milestones: '', team: '', communityBenefit: '',
};

function SubmitModal({ visible, onClose, walletAddress, coopId, coopName, primaryColor, accentColor }: {
  visible: boolean;
  onClose: () => void;
  walletAddress: string;
  coopId: string;
  coopName: string;
  primaryColor: string;
  accentColor: string;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const TOTAL = 4;

  useEffect(() => {
    setCategories([]);
    api.getCoopConfig(coopId).then(cfg => {
      if (cfg?.proposalCategories) {
        setCategories(
          cfg.proposalCategories
            .filter((c: { key: string; label: string; isActive: boolean }) => c.isActive)
            .map((c: { key: string; label: string; isActive: boolean }) => ({ id: c.key, label: c.label, description: '' }))
        );
      }
    }).catch(() => {/* silently ignore — user can still type category into proposal text */});
  }, [coopId]);

  function set<K extends keyof FormData>(field: K, value: FormData[K]) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function canProceed() {
    if (step === 1) return form.title.trim().length >= 10 && form.category !== '';
    if (step === 2) return form.summary.trim().length >= 30 && form.problem.trim().length >= 20 && form.solution.trim().length >= 20;
    if (step === 3) return form.budget.trim() !== '' && form.timeline !== '';
    if (step === 4) return form.impact.trim().length >= 20 && form.communityBenefit.trim().length >= 20;
    return false;
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const cat = categories.find(c => c.id === form.category);
      const text = [
        `Proposal Title: ${form.title}`,
        `Category: ${cat?.label ?? form.category}`,
        `Category Key: ${form.category}`,
        form.location ? `Location: ${form.location}` : '',
        `Summary: ${form.summary}`,
        `Problem Statement: ${form.problem}`,
        `Proposed Solution: ${form.solution}`,
        `Expected Impact: ${form.impact}`,
        `Community Benefit: ${form.communityBenefit}`,
        `Budget Requested: $${form.budget}`,
        `Timeline: ${form.timeline}`,
        form.milestones ? `Key Milestones: ${form.milestones}` : '',
        form.team ? `Team: ${form.team}` : '',
      ].filter(Boolean).join('\n\n');

      await api.createProposal(text, walletAddress, coopId);
      setSubmitted(true);
    } catch (e: unknown) {
      console.warn('Proposal submission error:', e);
      setError(e instanceof Error ? e.message : 'Could not submit this proposal.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setStep(1);
    setForm(EMPTY_FORM);
    setSubmitted(false);
    setSubmitting(false);
    setError(null);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.white }}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {step > 1 && !submitted && !submitting && (
              <TouchableOpacity onPress={() => setStep(s => s - 1)} hitSlop={8}>
                <ArrowLeft size={20} color={C.charcoal600} />
              </TouchableOpacity>
            )}
            <View>
              <Text style={{ fontWeight: '700', color: C.charcoal800, fontSize: 16 }}>
                {submitted ? 'Proposal Submitted' : submitting ? 'Submitting...' : 'Submit Proposal'}
              </Text>
              {!submitted && !submitting && (
                <Text style={{ color: C.charcoal400, fontSize: 12 }}>Step {step} of {TOTAL}</Text>
              )}
            </View>
          </View>
          <TouchableOpacity onPress={handleClose} hitSlop={8} style={{ padding: 4, backgroundColor: C.cream100, borderRadius: 99 }}>
            <X size={18} color={C.charcoal500} />
          </TouchableOpacity>
        </View>

        {/* Progress bar */}
        {!submitted && !submitting && (
          <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 16, paddingTop: 12 }}>
            {Array.from({ length: TOTAL }).map((_, i) => (
              <View key={i} style={{ flex: 1, height: 4, borderRadius: 99, backgroundColor: i + 1 <= step ? accentColor : C.cream200 }} />
            ))}
          </View>
        )}

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">

            {/* ── Submitting ── */}
            {submitting && (
              <View style={{ alignItems: 'center', paddingVertical: 64 }}>
                <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: withAlpha(accentColor, '1A', C.gold100), alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
                  <ActivityIndicator size="large" color={accentColor} />
                </View>
                <Text style={{ color: C.charcoal800, fontWeight: '700', fontSize: 17, marginBottom: 8 }}>AI is reviewing your proposal</Text>
                <Text style={{ color: C.charcoal400, fontSize: 13, textAlign: 'center', maxWidth: 280 }}>
                  Checking alignment with community values, feasibility, and potential impact...
                </Text>
                {['Analyzing community alignment', 'Checking feasibility', 'Evaluating impact potential'].map((check, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
                    {i === 0 ? <CheckCircle size={14} color={C.green600} /> : <Sparkles size={14} color={accentColor} />}
                    <Text style={{ color: C.charcoal600, fontSize: 13 }}>{check}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* ── Success ── */}
            {submitted && (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.green50, alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
                  <CheckCircle size={40} color={C.green600} />
                </View>
                <Text style={{ color: C.charcoal800, fontWeight: '700', fontSize: 20, marginBottom: 8 }}>Proposal Submitted</Text>
                <Text style={{ color: C.charcoal400, fontSize: 13, textAlign: 'center', maxWidth: 280, marginBottom: 24 }}>
                  Your proposal for {coopName} is now under AI review. You will be notified when it moves to community deliberation.
                </Text>

                {/* Submitted proposal card */}
                <View style={{ width: '100%', backgroundColor: C.cream50, borderRadius: 12, borderWidth: 1, borderColor: C.cream200, padding: 16, marginBottom: 24 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '600', color: C.charcoal800, fontSize: 14 }}>{form.title}</Text>
                      <Text style={{ color: C.charcoal500, fontSize: 12, marginTop: 2 }}>
                        {categories.find(c => c.id === form.category)?.label ?? form.category}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: C.blue50, borderColor: '#93C5FD', borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Sparkles size={10} color={C.blue600} />
                      <Text style={{ color: C.blue700, fontSize: 10, fontWeight: '600' }}>AI Review</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <DollarSign size={12} color={C.charcoal500} />
                      <Text style={{ color: C.charcoal500, fontSize: 12 }}>${Number(form.budget || 0).toLocaleString()}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Clock size={12} color={C.charcoal500} />
                      <Text style={{ color: C.charcoal500, fontSize: 12 }}>{form.timeline}</Text>
                    </View>
                  </View>
                </View>

                {/* What happens next */}
                <View style={{ width: '100%', marginBottom: 8 }}>
                  <Text style={{ fontWeight: '600', fontSize: 14, color: C.charcoal800, marginBottom: 12 }}>What happens next</Text>
                  {[
                    { n: 1, label: 'AI Review', desc: 'Our AI reviews for community alignment and feasibility', active: true },
                    { n: 2, label: 'Community Deliberation', desc: 'Members discuss, ask questions, and provide feedback', active: false },
                    { n: 3, label: 'Admin Decision', desc: 'Community admins approve or reject based on feedback', active: false },
                    { n: 4, label: 'Funding', desc: 'Approved proposals receive funding from the commons treasury', active: false },
                  ].map(item => (
                    <View key={item.n} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: item.active ? accentColor : C.cream200 }}>
                        <Text style={{ color: item.active ? C.white : C.charcoal400, fontSize: 12, fontWeight: '700' }}>{item.n}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '500', color: item.active ? C.charcoal800 : C.charcoal500 }}>{item.label}</Text>
                        <Text style={{ fontSize: 11, color: C.charcoal400, marginTop: 1 }}>{item.desc}</Text>
                      </View>
                    </View>
                  ))}
                </View>

                <TouchableOpacity onPress={handleClose} style={[styles.primaryBtn, { width: '100%', marginTop: 8, backgroundColor: accentColor }]}>
                  <Text style={{ color: C.white, fontWeight: '600', fontSize: 15 }}>Back to Proposals</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Step 1: Title & Category ── */}
            {!submitting && !submitted && step === 1 && (
              <View style={{ gap: 20 }}>
                <View style={[styles.tipBanner, { backgroundColor: withAlpha(accentColor, '12', C.gold50), borderColor: withAlpha(accentColor, '30', C.gold200) }]}>
                  <Lightbulb size={14} color={accentColor} />
                  <Text style={{ color: accentColor, fontSize: 12, flex: 1, lineHeight: 18 }}>
                    Great proposals solve a real community problem and clearly explain how they will benefit members.
                  </Text>
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>Proposal Title *</Text>
                  <TextInput
                    value={form.title}
                    onChangeText={v => set('title', v)}
                    placeholder="e.g., Community Youth Mentorship Program"
                    placeholderTextColor={C.charcoal400}
                    style={styles.input}
                  />
                  <Text style={{ color: C.charcoal400, fontSize: 11 }}>
                    {form.title.length < 10 ? `${10 - form.title.length} more chars needed` : 'Looks good'}
                  </Text>
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>
                    Location <Text style={{ fontWeight: '400', color: C.charcoal400 }}>(optional)</Text>
                  </Text>
                  <TextInput
                    value={form.location}
                    onChangeText={v => set('location', v)}
                    placeholder="e.g., Atlanta, GA or South Side Chicago"
                    placeholderTextColor={C.charcoal400}
                    style={styles.input}
                  />
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>Category *</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {categories.map(cat => {
                      const selected = form.category === cat.id;
                      return (
                        <TouchableOpacity
                          key={cat.id}
                          onPress={() => set('category', cat.id)}
                          style={{ borderWidth: 2, borderColor: selected ? accentColor : C.cream200, backgroundColor: selected ? withAlpha(accentColor, '12', C.gold50) : C.white, borderRadius: 12, padding: 12, width: '47%' }}
                        >
                          <Text style={{ color: C.charcoal800, fontSize: 12, fontWeight: '600', marginTop: 4 }}>{cat.label}</Text>
                          {cat.description ? (
                            <Text style={{ color: C.charcoal400, fontSize: 11, marginTop: 2, lineHeight: 15 }}>{cat.description}</Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                    {categories.length === 0 && (
                      <Text style={{ color: C.charcoal400, fontSize: 12 }}>Loading categories…</Text>
                    )}
                  </View>
                </View>
              </View>
            )}

            {/* ── Step 2: Description ── */}
            {!submitting && !submitted && step === 2 && (
              <View style={{ gap: 20 }}>
                {([
                  { field: 'summary' as const, label: 'Summary *', placeholder: 'Briefly describe your proposal in 2-3 sentences...', min: 30, rows: 3 },
                  { field: 'problem' as const, label: 'Problem Statement *', placeholder: 'What community problem does this address?', min: 20, rows: 3 },
                  { field: 'solution' as const, label: 'Proposed Solution *', placeholder: 'How will you solve this problem?', min: 20, rows: 3 },
                ] as const).map(f => (
                  <View key={f.field} style={{ gap: 6 }}>
                    <Text style={styles.label}>{f.label}</Text>
                    <TextInput
                      value={form[f.field]}
                      onChangeText={v => set(f.field, v)}
                      placeholder={f.placeholder}
                      placeholderTextColor={C.charcoal400}
                      multiline
                      numberOfLines={f.rows}
                      textAlignVertical="top"
                      style={[styles.input, { minHeight: f.rows * 28, paddingTop: 12 }]}
                    />
                    {form[f.field].length < f.min && (
                      <Text style={{ color: C.charcoal400, fontSize: 11 }}>{f.min - form[f.field].length} more chars needed</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* ── Step 3: Budget & Timeline ── */}
            {!submitting && !submitted && step === 3 && (
              <View style={{ gap: 20 }}>
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>Budget Requested ($) *</Text>
                  <View style={[styles.input, { flexDirection: 'row', alignItems: 'center', paddingVertical: 0 }]}>
                    <DollarSign size={16} color={C.charcoal500} />
                    <TextInput
                      value={form.budget}
                      onChangeText={v => set('budget', v)}
                      keyboardType="numeric"
                      placeholder="15000"
                      placeholderTextColor={C.charcoal400}
                      style={{ flex: 1, paddingVertical: 12, paddingLeft: 6, fontSize: 14, color: C.charcoal800 }}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {BUDGET_RANGES.map(range => {
                      const num = Number(form.budget);
                      const selected = num >= range.min && num <= range.max;
                      return (
                        <TouchableOpacity
                          key={range.label}
                          onPress={() => set('budget', String(range.min))}
                          style={{ borderWidth: 2, borderColor: selected ? accentColor : C.cream200, backgroundColor: selected ? withAlpha(accentColor, '12', C.gold50) : C.white, borderRadius: 10, padding: 10, width: '47%' }}
                        >
                          <Text style={{ color: C.charcoal800, fontSize: 12, fontWeight: '600' }}>{range.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>Timeline *</Text>
                  {TIMELINES.map(t => {
                    const selected = form.timeline === t;
                    return (
                      <TouchableOpacity
                        key={t}
                        onPress={() => set('timeline', t)}
                        style={{ borderWidth: 2, borderColor: selected ? accentColor : C.cream200, backgroundColor: selected ? withAlpha(accentColor, '12', C.gold50) : C.white, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14 }}
                      >
                        <Text style={{ color: C.charcoal800, fontSize: 14, fontWeight: '500' }}>{t}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={styles.label}>Key Milestones <Text style={{ fontWeight: '400', color: C.charcoal400 }}>(optional)</Text></Text>
                  <TextInput
                    value={form.milestones}
                    onChangeText={v => set('milestones', v)}
                    placeholder="Month 1: Secure location, Month 3: Launch..."
                    placeholderTextColor={C.charcoal400}
                    multiline numberOfLines={3} textAlignVertical="top"
                    style={[styles.input, { minHeight: 72, paddingTop: 12 }]}
                  />
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={styles.label}>Team / Who is Involved <Text style={{ fontWeight: '400', color: C.charcoal400 }}>(optional)</Text></Text>
                  <TextInput
                    value={form.team}
                    onChangeText={v => set('team', v)}
                    placeholder="Who will execute this proposal?"
                    placeholderTextColor={C.charcoal400}
                    multiline numberOfLines={2} textAlignVertical="top"
                    style={[styles.input, { minHeight: 56, paddingTop: 12 }]}
                  />
                </View>
              </View>
            )}

            {/* ── Step 4: Impact & Review ── */}
            {!submitting && !submitted && step === 4 && (
              <View style={{ gap: 20 }}>
                {([
                  { field: 'impact' as const, label: 'Expected Impact *', placeholder: 'How many people will this help? What measurable outcomes do you expect?', rows: 3 },
                  { field: 'communityBenefit' as const, label: 'Community Benefit *', placeholder: 'How does this strengthen our community and build collective wealth?', rows: 3 },
                ] as const).map(f => (
                  <View key={f.field} style={{ gap: 6 }}>
                    <Text style={styles.label}>{f.label}</Text>
                    <TextInput
                      value={form[f.field]}
                      onChangeText={v => set(f.field, v)}
                      placeholder={f.placeholder}
                      placeholderTextColor={C.charcoal400}
                      multiline numberOfLines={f.rows} textAlignVertical="top"
                      style={[styles.input, { minHeight: f.rows * 28, paddingTop: 12 }]}
                    />
                    {form[f.field].length < 20 && (
                      <Text style={{ color: C.charcoal400, fontSize: 11 }}>{20 - form[f.field].length} more chars needed</Text>
                    )}
                  </View>
                ))}

                {/* Review summary */}
                <View style={{ backgroundColor: C.cream50, borderRadius: 12, borderWidth: 1, borderColor: C.cream200, padding: 16, gap: 8 }}>
                  <Text style={{ fontWeight: '600', fontSize: 13, color: C.charcoal800, marginBottom: 4 }}>Proposal Summary</Text>
                  <Text style={{ color: C.charcoal400, fontSize: 11 }}>Title</Text>
                  <Text style={{ color: C.charcoal800, fontSize: 13, fontWeight: '500' }}>{form.title}</Text>
                  <Text style={{ color: C.charcoal400, fontSize: 11, marginTop: 4 }}>Category</Text>
                  <View style={{ backgroundColor: withAlpha(accentColor, '1A', C.gold100), borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginTop: 2 }}>
                    <Text style={{ color: accentColor, fontSize: 11, fontWeight: '600' }}>
                      {categories.find(c => c.id === form.category)?.label ?? form.category}
                    </Text>
                  </View>
                  {form.location !== '' && (
                    <>
                      <Text style={{ color: C.charcoal400, fontSize: 11, marginTop: 4 }}>Location</Text>
                      <Text style={{ color: C.charcoal800, fontSize: 13 }}>{form.location}</Text>
                    </>
                  )}
                  <Text style={{ color: C.charcoal400, fontSize: 11, marginTop: 4 }}>Budget / Timeline</Text>
                  <Text style={{ color: C.charcoal800, fontSize: 13 }}>${Number(form.budget || 0).toLocaleString()} / {form.timeline}</Text>
                  <Text style={{ color: C.charcoal400, fontSize: 11, marginTop: 4 }}>Summary</Text>
                  <Text style={{ color: C.charcoal600, fontSize: 12, lineHeight: 18 }}>{form.summary}</Text>
                </View>

                {error && (
                  <View style={{ backgroundColor: C.red50, borderWidth: 1, borderColor: C.red200, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 8 }}>
                    <AlertCircle size={14} color={C.redText} />
                    <Text style={{ color: C.redText, fontSize: 12, flex: 1 }}>{error}</Text>
                  </View>
                )}

                <View style={[styles.tipBanner, { backgroundColor: withAlpha(accentColor, '12', C.gold50), borderColor: withAlpha(accentColor, '30', C.gold200) }]}>
                  <AlertCircle size={14} color={accentColor} />
                  <Text style={{ color: accentColor, fontSize: 12, flex: 1, lineHeight: 18 }}>
                    By submitting, your proposal will undergo AI review for community alignment and feasibility. If approved, it enters community deliberation.
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Footer buttons */}
        {!submitting && !submitted && (
          <View style={styles.modalFooter}>
            {step > 1 && (
              <TouchableOpacity onPress={() => setStep(s => s - 1)} style={styles.secondaryBtn}>
                <ArrowLeft size={16} color={C.charcoal600} />
                <Text style={{ color: C.charcoal600, fontWeight: '600', fontSize: 14 }}>Back</Text>
              </TouchableOpacity>
            )}
            {step < TOTAL ? (
              <TouchableOpacity
                onPress={() => setStep(s => s + 1)}
                disabled={!canProceed()}
                style={[styles.primaryBtn, { opacity: canProceed() ? 1 : 0.4, backgroundColor: accentColor }]}
              >
                <Text style={{ color: C.white, fontWeight: '600', fontSize: 14 }}>Continue</Text>
                <ArrowRight size={16} color={C.white} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={!canProceed()}
                style={[styles.primaryBtn, { opacity: canProceed() ? 1 : 0.4, backgroundColor: accentColor }]}
              >
                <Sparkles size={16} color={C.white} />
                <Text style={{ color: C.white, fontWeight: '600', fontSize: 14 }}>Submit for AI Review</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

const PAGE_LIMIT = 20;

export default function ProposalsScreen() {
  const params = useLocalSearchParams<{ coopId?: string }>();
  const { sessionToken, user } = useAuth();
  const config = coopConfig();
  const scopedCoopId = params.coopId || user?.coop?.id || (config.id && config.id !== 'default' ? config.id : 'cahootz');
  const [coopName, setCoopName] = useState(scopedCoopId);
  const [membershipChecked, setMembershipChecked] = useState(false);
  const [hasProposalAccess, setHasProposalAccess] = useState(false);
  const primaryColor = resolveBrandColor(user?.coop?.primaryColor || config.primaryColor, C.red700);
  const accentColor = resolveBrandColor(user?.coop?.accentColor || config.accentColor, C.gold600);
  const [activeTab, setActiveTab] = useState<TabKey>('submitted');
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [showSubmit, setShowSubmit] = useState(false);

  useEffect(() => {
    let mounted = true;
    api.getCoopConfig(scopedCoopId)
      .then((cfg) => {
        if (mounted) setCoopName(cfg?.name || cfg?.slug || scopedCoopId);
      })
      .catch(() => {
        if (mounted) setCoopName(scopedCoopId);
      });

    return () => {
      mounted = false;
    };
  }, [scopedCoopId]);

  useEffect(() => {
    let mounted = true;
    setMembershipChecked(false);
    setHasProposalAccess(false);

    if (!sessionToken) {
      setMembershipChecked(true);
      return () => {
        mounted = false;
      };
    }

    api.listCommonsDirectory(sessionToken)
      .then((result) => {
        if (!mounted) return;
        setHasProposalAccess(
          result.coops.some((commons) => commons.id === scopedCoopId && commons.accessStatus === 'ACTIVE')
        );
      })
      .catch(() => {
        if (mounted) setHasProposalAccess(false);
      })
      .finally(() => {
        if (mounted) setMembershipChecked(true);
      });

    return () => {
      mounted = false;
    };
  }, [scopedCoopId, sessionToken]);

  const loadProposals = useCallback(async (currentOffset = 0, append = false) => {
    if (!user || !membershipChecked || !hasProposalAccess) {
      setLoading(false);
      return;
    }
    try {
      if (activeTab === 'mine') {
        if (!user.walletAddress) { setProposals([]); setHasMore(false); return; }
        const result = await api.getMyProposals(user.walletAddress, PAGE_LIMIT, currentOffset, scopedCoopId);
        const newItems = result?.proposals ?? [];
        setProposals(append ? prev => [...prev, ...newItems] : newItems);
        setHasMore(currentOffset + PAGE_LIMIT < (result?.total ?? 0));
      } else {
        const result = await api.listProposals({ coopId: scopedCoopId, status: activeTab, limit: PAGE_LIMIT, offset: currentOffset }, user.walletAddress);
        const newItems = result?.proposals ?? [];
        setProposals(append ? prev => [...prev, ...newItems] : newItems);
        setHasMore(result?.hasMore ?? false);
      }
    } catch {
      if (!append) setProposals([]);
      setHasMore(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [activeTab, hasProposalAccess, membershipChecked, scopedCoopId, user]);

  useEffect(() => {
    setLoading(true);
    setProposals([]);
    setOffset(0);
    setHasMore(false);
    loadProposals(0, false);
  }, [loadProposals]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setOffset(0);
    loadProposals(0, false);
  }, [loadProposals]);

  function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    const nextOffset = offset + PAGE_LIMIT;
    setOffset(nextOffset);
    setLoadingMore(true);
    loadProposals(nextOffset, true);
  }

  function handleSubmitClose() {
    setShowSubmit(false);
    setActiveTab('submitted');
    setLoading(true);
    setOffset(0);
    setTimeout(() => loadProposals(0, false), 300);
  }

  if (membershipChecked && !hasProposalAccess) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.cream100 }}>
        <View style={{ padding: 16 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <ArrowLeft size={20} color={C.charcoal800} />
          </TouchableOpacity>
          <View style={{ backgroundColor: C.white, borderRadius: 16, borderWidth: 1, borderColor: C.cream200, padding: 20 }}>
            <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: C.gold50, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Lock size={28} color={accentColor} />
            </View>
            <Text style={{ color: C.charcoal800, fontWeight: '700', fontSize: 20 }}>{coopName} proposals are locked</Text>
            <Text style={{ color: C.charcoal500, fontSize: 14, lineHeight: 21, marginTop: 8 }}>
              You can view and submit proposals after your membership in this commons is approved.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.cream100 }}>
      {/* Header */}
      <LinearGradient colors={['#111827', primaryColor, accentColor]} style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: C.white, fontWeight: '700', fontSize: 20 }}>{coopName} Proposals</Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 }}>Submit and deliberate inside this commons</Text>
          </View>
          <TouchableOpacity onPress={() => setShowSubmit(true)} style={{ backgroundColor: C.whiteA20, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Plus size={16} color={C.white} />
            <Text style={{ color: C.white, fontWeight: '600', fontSize: 13 }}>Submit</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* How it works banner */}
      <View style={{ backgroundColor: withAlpha(accentColor, '12', C.gold50), borderBottomWidth: 1, borderBottomColor: withAlpha(accentColor, '30', C.gold200), paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Sparkles size={14} color={accentColor} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: C.charcoal800, fontSize: 12, lineHeight: 18 }}>
            Submit → AI scores mission goals → Funding
          </Text>
          <Text style={{ color: accentColor, fontSize: 11, lineHeight: 16 }}>
            Large budgets may also require expert review, community deliberation, and an admin decision before funding is released.
          </Text>
        </View>
      </View>

      {/* Tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ backgroundColor: C.white, borderBottomWidth: 1, borderBottomColor: C.cream200, maxHeight: 48 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}
      >
        {STATUS_TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={{ height: 32, borderRadius: 8, paddingHorizontal: 12, backgroundColor: activeTab === tab.key ? accentColor : '#F9FAFB', borderWidth: activeTab === tab.key ? 0 : 1, borderColor: C.cream200, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: activeTab === tab.key ? C.white : C.charcoal600, fontWeight: '600', fontSize: 12 }}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Proposal list */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accentColor} />}
      >
        {loading ? (
          <View style={{ paddingVertical: 64, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={accentColor} />
            <Text style={{ color: C.charcoal400, fontSize: 13, marginTop: 12 }}>Loading proposals...</Text>
          </View>
        ) : proposals.length === 0 ? (
          <EmptyState tab={activeTab} accentColor={accentColor} />
        ) : (
          <>
            {proposals.map(p => <ProposalCard key={p.id} proposal={p} accentColor={accentColor} />)}

            {hasMore && (
              <TouchableOpacity
                onPress={handleLoadMore}
                disabled={loadingMore}
                style={{ marginTop: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: C.cream300, backgroundColor: C.white, alignItems: 'center', opacity: loadingMore ? 0.6 : 1 }}
              >
                {loadingMore
                  ? <ActivityIndicator size="small" color={accentColor} />
                  : <Text style={{ color: C.charcoal600, fontWeight: '600', fontSize: 14 }}>Load More</Text>
                }
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>

      {/* Submit modal */}
      {user?.walletAddress && (
        <SubmitModal
          visible={showSubmit}
          onClose={handleSubmitClose}
          walletAddress={user.walletAddress}
          coopId={scopedCoopId}
          coopName={coopName}
          primaryColor={primaryColor}
          accentColor={accentColor}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.white,
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.cream200,
  },
  modalFooter: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: C.cream200,
    flexDirection: 'row',
    gap: 12,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: C.red700,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.cream300,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tipBanner: {
    backgroundColor: C.gold50,
    borderWidth: 1,
    borderColor: C.gold200,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  label: {
    color: C.charcoal700,
    fontWeight: '600',
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: C.cream300,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: C.charcoal800,
    backgroundColor: C.white,
  },
});
