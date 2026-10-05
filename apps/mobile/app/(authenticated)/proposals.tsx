import React, { useState, useEffect } from 'react';
import {
  ScrollView,
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CheckCircle,
  Sparkles,
  X,
  AlertCircle,
  Lightbulb,
  DollarSign,
} from 'lucide-react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { Text } from '@/components/ui/text';
import { api } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { withAlpha } from '@/lib/brand-colors';

// ── Colors ───────────────────────────────────────────────────────────────────

const C = {
  red700: '#B91C1C',
  red800: '#991B1B',
  gold50: '#FFFBEB',
  gold100: '#FEF3C7',
  gold200: '#FDE68A',
  gold600: '#FF8A2A',
  gold700: '#FF6B00',
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
  amber700: '#FF6B00',
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

interface Category {
  id: string;
  label: string;
  description: string;
}

type CategoryId = string;

const TIMELINES = ['Within a month', '1-3 months', '3-6 months', '6-12 months', 'Longer than a year', 'Not sure yet'];

// One screen, three plain questions. The AI review reads this as free text
// and asks the person for anything it still needs, so nothing else is
// required up front. Extra detail lives in an optional, folded section.
interface FormData {
  idea: string;
  category: CategoryId | '';
  why: string;
  cost: string;
  costUnsure: boolean;
  timeline: string;
  location: string;
  milestones: string;
  team: string;
}

const EMPTY_FORM: FormData = {
  idea: '', category: '', why: '', cost: '', costUnsure: false, timeline: '',
  location: '', milestones: '', team: '',
};

const MIN_IDEA = 5;
const MIN_WHY = 20;

/** Plain list of what's still missing, so Send can say why it can't go yet. */
function missingProposalParts(form: FormData, hasCategories: boolean): string[] {
  const missing: string[] = [];
  if (form.idea.trim().length < MIN_IDEA) missing.push('Say what you want to do');
  if (hasCategories && !form.category) missing.push('Pick the kind of proposal');
  if (form.why.trim().length < MIN_WHY) missing.push('Say why it matters and who it helps (a sentence or two)');
  if (!form.costUnsure && form.cost.trim() === '') missing.push('Give a rough cost, or tap "Not sure yet"');
  if (!form.timeline) missing.push('Pick when it would happen');
  return missing;
}

export function SubmitModal({ visible, onClose, walletAddress, coopId, coopName, primaryColor, accentColor }: {
  visible: boolean;
  onClose: () => void;
  walletAddress: string;
  coopId: string;
  coopName: string;
  primaryColor: string;
  accentColor: string;
}) {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [showMore, setShowMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

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
    }).catch(() => {/* no categories: the AI review picks one from the text */});
  }, [coopId]);

  function set<K extends keyof FormData>(field: K, value: FormData[K]) {
    setForm(prev => ({ ...prev, [field]: value }));
    setError(null);
  }

  const categoryLabel = categories.find(c => c.id === form.category)?.label ?? form.category;
  const costText = form.costUnsure || form.cost.trim() === ''
    ? 'Not sure yet'
    : `$${Number(form.cost.replace(/[^0-9.]/g, '') || 0).toLocaleString()}`;

  async function handleSubmit() {
    const missing = missingProposalParts(form, categories.length > 0);
    if (missing.length > 0) {
      setError(`Almost there. To send it:\n• ${missing.join('\n• ')}`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const text = [
        `Proposal Title: ${form.idea.trim()}`,
        form.category ? `Category: ${categoryLabel}` : '',
        form.category ? `Category Key: ${form.category}` : '',
        form.location.trim() ? `Location: ${form.location.trim()}` : '',
        `Summary: ${form.why.trim()}`,
        `Why it matters and who it helps: ${form.why.trim()}`,
        `Budget Requested: ${costText}`,
        `Timeline: ${form.timeline}`,
        form.milestones.trim() ? `Key Milestones: ${form.milestones.trim()}` : '',
        form.team.trim() ? `Team: ${form.team.trim()}` : '',
      ].filter(Boolean).join('\n\n');

      await api.createProposal(text, walletAddress, coopId);
      setSubmitted(true);
    } catch (e: unknown) {
      console.warn('Proposal submission error:', e);
      setError(friendlyError(e, "We couldn't send your proposal."));
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setForm(EMPTY_FORM);
    setShowMore(false);
    setSubmitted(false);
    setSubmitting(false);
    setError(null);
    onClose();
  }

  const chip = (selected: boolean) => ({
    borderWidth: 2,
    borderColor: selected ? accentColor : C.cream200,
    backgroundColor: selected ? withAlpha(accentColor, '12', C.gold50) : C.white,
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center' as const,
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.white }}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <Text style={{ fontWeight: '700', color: C.charcoal800, fontSize: 17 }}>
            {submitted ? 'Proposal sent' : submitting ? 'Sending...' : 'New proposal'}
          </Text>
          <TouchableOpacity
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: C.cream100, borderRadius: 99 }}
          >
            <X size={18} color={C.charcoal500} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">

            {/* ── Sending ── */}
            {submitting && (
              <View style={{ alignItems: 'center', paddingVertical: 64 }}>
                <ActivityIndicator size="large" color={accentColor} />
                <Text style={{ color: C.charcoal800, fontWeight: '700', fontSize: 17, marginTop: 24, marginBottom: 8 }}>Sending your proposal</Text>
                <Text style={{ color: C.charcoal600, fontSize: 15, textAlign: 'center', maxWidth: 300 }}>
                  An AI helper checks it first and will ask you if anything is missing.
                </Text>
              </View>
            )}

            {/* ── Sent ── */}
            {submitted && (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.green50, alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
                  <CheckCircle size={40} color={C.green600} />
                </View>
                <Text style={{ color: C.charcoal800, fontWeight: '700', fontSize: 20, marginBottom: 8 }}>Your proposal was sent</Text>
                <Text style={{ color: C.charcoal600, fontSize: 15, textAlign: 'center', maxWidth: 300, marginBottom: 24 }}>
                  &ldquo;{form.idea.trim()}&rdquo; is now with {coopName}. An AI helper checks it first. If it needs more
                  detail, you&apos;ll get an alert. Then members talk it over and decide.
                </Text>
                <TouchableOpacity
                  onPress={handleClose}
                  accessibilityRole="button"
                  style={[styles.primaryBtn, { width: '100%', minHeight: 48, backgroundColor: accentColor }]}
                >
                  <Text style={{ color: C.white, fontWeight: '700', fontSize: 16 }}>Back to proposals</Text>
                </TouchableOpacity>
              </View>
            )}

            {!submitting && !submitted && (
              <View style={{ gap: 24 }}>
                <View style={[styles.tipBanner, { backgroundColor: withAlpha(accentColor, '12', C.gold50), borderColor: withAlpha(accentColor, '30', C.gold200) }]}>
                  <Lightbulb size={16} color={accentColor} />
                  <Text style={{ color: C.charcoal800, fontSize: 15, flex: 1, lineHeight: 21 }}>
                    Three quick questions. Plain words are fine. You can add more later.
                  </Text>
                </View>

                {/* 1. What */}
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>1. What do you want to do?</Text>
                  <TextInput
                    value={form.idea}
                    onChangeText={v => set('idea', v)}
                    placeholder="e.g., Start a weekly tutoring program for kids"
                    placeholderTextColor={C.charcoal500}
                    accessibilityLabel="What do you want to do?"
                    style={styles.input}
                  />
                  {categories.length > 0 && (
                    <>
                      <Text style={{ color: C.charcoal600, fontSize: 15, marginTop: 4 }}>What kind of proposal is it?</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {categories.map(cat => (
                          <TouchableOpacity
                            key={cat.id}
                            onPress={() => set('category', cat.id)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: form.category === cat.id }}
                            style={chip(form.category === cat.id)}
                          >
                            <Text style={{ color: C.charcoal800, fontSize: 15, fontWeight: '600' }}>{cat.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}
                </View>

                {/* 2. Why */}
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>2. Why does it matter, and who does it help?</Text>
                  <TextInput
                    value={form.why}
                    onChangeText={v => set('why', v)}
                    placeholder="e.g., Many kids on our block fall behind in reading. This gives them a safe place to get help after school."
                    placeholderTextColor={C.charcoal500}
                    accessibilityLabel="Why does it matter, and who does it help?"
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    style={[styles.input, { minHeight: 112, paddingTop: 12 }]}
                  />
                </View>

                {/* 3. What it takes */}
                <View style={{ gap: 8 }}>
                  <Text style={styles.label}>3. What will it take?</Text>
                  <Text style={{ color: C.charcoal600, fontSize: 15 }}>About how much money? A rough guess is fine.</Text>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <View style={[styles.input, { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 0, opacity: form.costUnsure ? 0.5 : 1 }]}>
                      <DollarSign size={16} color={C.charcoal600} />
                      <TextInput
                        value={form.cost}
                        onChangeText={v => setForm(prev => ({ ...prev, cost: v, costUnsure: v ? false : prev.costUnsure }))}
                        editable={!form.costUnsure}
                        keyboardType="numeric"
                        placeholder="500"
                        placeholderTextColor={C.charcoal500}
                        accessibilityLabel="Rough cost in dollars"
                        style={{ flex: 1, paddingVertical: 12, paddingLeft: 6, fontSize: 16, color: C.charcoal800 }}
                      />
                    </View>
                    <TouchableOpacity
                      onPress={() => setForm(prev => ({ ...prev, costUnsure: !prev.costUnsure, cost: prev.costUnsure ? prev.cost : '' }))}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: form.costUnsure }}
                      style={chip(form.costUnsure)}
                    >
                      <Text style={{ color: C.charcoal800, fontSize: 15, fontWeight: '600' }}>Not sure yet</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{ color: C.charcoal600, fontSize: 15, marginTop: 8 }}>When would it happen?</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {TIMELINES.map(t => (
                      <TouchableOpacity
                        key={t}
                        onPress={() => set('timeline', t)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: form.timeline === t }}
                        style={chip(form.timeline === t)}
                      >
                        <Text style={{ color: C.charcoal800, fontSize: 15, fontWeight: '600' }}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Optional detail */}
                <View style={{ gap: 12 }}>
                  <TouchableOpacity
                    onPress={() => setShowMore(v => !v)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showMore }}
                    style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    <Text style={{ color: accentColor, fontSize: 16, fontWeight: '700' }}>
                      {showMore ? 'Hide extra detail' : 'Add more detail (optional)'}
                    </Text>
                  </TouchableOpacity>
                  {showMore && (
                    <View style={{ gap: 16 }}>
                      {([
                        { field: 'location' as const, label: 'Where?', placeholder: 'e.g., East Oakland, or online', rows: 1 },
                        { field: 'milestones' as const, label: 'Main steps', placeholder: 'e.g., Month 1: find a room. Month 2: start sessions.', rows: 3 },
                        { field: 'team' as const, label: 'Who will help?', placeholder: 'e.g., Me and two retired teachers', rows: 2 },
                      ]).map(f => (
                        <View key={f.field} style={{ gap: 6 }}>
                          <Text style={styles.label}>{f.label}</Text>
                          <TextInput
                            value={form[f.field]}
                            onChangeText={v => set(f.field, v)}
                            placeholder={f.placeholder}
                            placeholderTextColor={C.charcoal500}
                            accessibilityLabel={f.label}
                            multiline={f.rows > 1}
                            numberOfLines={f.rows}
                            textAlignVertical="top"
                            style={[styles.input, f.rows > 1 ? { minHeight: f.rows * 28, paddingTop: 12 } : null]}
                          />
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {error && (
                  <View accessibilityRole="alert" style={{ backgroundColor: C.red50, borderWidth: 1, borderColor: C.red200, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 8 }}>
                    <AlertCircle size={16} color={C.redText} />
                    <Text style={{ color: C.redText, fontSize: 15, flex: 1, lineHeight: 21 }}>{error}</Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Footer */}
        {!submitting && !submitted && (
          <View style={styles.modalFooter}>
            <TouchableOpacity
              onPress={handleSubmit}
              accessibilityRole="button"
              style={[styles.primaryBtn, { minHeight: 48, backgroundColor: accentColor }]}
            >
              <Sparkles size={16} color={C.white} />
              <Text style={{ color: C.white, fontWeight: '700', fontSize: 16 }}>Send proposal</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function ProposalsRedirect() {
  const params = useLocalSearchParams<{ coopId?: string; submit?: string }>();

  return (
    <Redirect
      href={{
        pathname: '/(tabs)/proposals',
        params: {
          ...(params.coopId ? { coopId: params.coopId } : {}),
          ...(params.submit ? { submit: params.submit } : {}),
        },
      } as any}
    />
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
