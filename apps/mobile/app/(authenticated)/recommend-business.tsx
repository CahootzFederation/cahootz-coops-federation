import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Check, Store } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import { useAuth } from '@/contexts/auth-context';
import { api, resolveCoopId, type DealCategoryOption, type MyBusinessReferral } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { keyboardInsetScrollProps } from '@/lib/keyboard';

const colors = { paper: DESIGN.paper, ink: DESIGN.ink, muted: DESIGN.muted, line: DESIGN.border, orange: '#E85D04', forest: '#245B45', forestSoft: '#E7F3ED', red: '#B42318' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A member recommends a local business that might give this Commons a deal. */
export default function RecommendBusinessScreen() {
  const params = useLocalSearchParams<{ coopId?: string }>();
  const coopId = params.coopId || resolveCoopId();
  const { sessionToken } = useAuth();
  const [categories, setCategories] = useState<DealCategoryOption[]>([]);
  const [mine, setMine] = useState<MyBusinessReferral[]>([]);
  const [form, setForm] = useState({ businessName: '', category: '', description: '', website: '', email: '', phone: '', city: '', howKnown: '' });
  const [mayName, setMayName] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!sessionToken) return;
    const [options, referrals] = await Promise.all([
      api.getDealCategories(sessionToken).catch(() => []),
      api.getMyBusinessReferrals(coopId, sessionToken).catch(() => []),
    ]);
    setCategories(options);
    setMine(referrals);
  }, [coopId, sessionToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (!sessionToken) return;
    const problem =
      form.businessName.trim().length < 2
        ? "Add the business's name."
        : !form.website.trim() && !form.email.trim() && !form.phone.trim()
          ? 'Add a website, email or phone so we can reach them.'
          : form.email.trim() && !EMAIL.test(form.email.trim())
            ? "That email doesn't look right."
            : !confirmed
              ? "Tick the box to confirm this is the business's public contact, or that they're OK being contacted."
              : null;
    if (problem) {
      setMessage({ tone: 'error', text: problem });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.recommendBusiness(
        {
          coopId,
          businessName: form.businessName.trim(),
          category: form.category || undefined,
          description: form.description.trim() || undefined,
          website: form.website.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          city: form.city.trim() || undefined,
          howKnown: form.howKnown.trim() || undefined,
          mayNameReferrer: mayName,
          confirmedPublicContact: true,
        },
        sessionToken,
      );
      setMessage({
        tone: 'ok',
        text: result.duplicate
          ? "You've already recommended them. Thanks again!"
          : result.alreadyKnown
            ? "Thanks! Someone else recommended them too, which helps a lot."
            : "Thanks! We'll take a look and reach out if they're a good fit.",
      });
      setForm({ businessName: '', category: '', description: '', website: '', email: '', phone: '', city: '', howKnown: '' });
      setMayName(false);
      setConfirmed(false);
      await load();
    } catch (error) {
      setMessage({ tone: 'error', text: friendlyError(error, "Your recommendation didn't send. Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, key: keyof typeof form, props: Partial<React.ComponentProps<typeof TextInput>> = {}) => (
    <View className="mt-3">
      <Text className="text-xs font-black" style={{ color: colors.muted }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={form[key]}
        onChangeText={set(key)}
        placeholderTextColor="#A6998A"
        className="mt-1 min-h-[44px] rounded-xl border bg-white px-3 text-sm"
        style={{ borderColor: colors.line, color: colors.ink }}
        {...props}
      />
    </View>
  );

  const checkbox = (checked: boolean, onPress: () => void, label: string) => (
    <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked }} aria-checked={checked} accessibilityLabel={label} onPress={onPress} className="mt-4 flex-row items-start">
      <View className="mr-3 mt-0.5 h-5 w-5 items-center justify-center rounded border" style={{ borderColor: colors.ink, backgroundColor: checked ? colors.ink : '#FFFFFF' }}>
        {checked ? <Check size={14} color="#FFFFFF" /> : null}
      </View>
      <Text className="flex-1 text-sm" style={{ color: colors.ink }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView className="flex-1" edges={['top']} style={{ backgroundColor: colors.paper }}>
      <View className="flex-row items-center px-4 py-3">
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="h-11 w-11 items-center justify-center">
          <ArrowLeft size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text className="ml-2 text-base font-black" style={{ color: colors.ink }}>Recommend a business</Text>
      </View>
      <ScrollView {...keyboardInsetScrollProps} contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <Text className="text-sm" style={{ color: colors.ink }}>
          Know a local business that might give our community a better price? Tell us about them and we&apos;ll reach out.
        </Text>

        {field('Business name', 'businessName', { placeholder: "e.g. Corner Market" })}

        <Text className="mt-4 text-xs font-black" style={{ color: colors.muted }}>What do they sell?</Text>
        <View className="mt-1 flex-row flex-wrap gap-2" accessibilityRole="radiogroup" accessibilityLabel="Category">
          {categories.map((option) => {
            const selected = form.category === option.key;
            return (
              <TouchableOpacity
                key={option.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                aria-checked={selected}
                onPress={() => set('category')(selected ? '' : option.key)}
                className="rounded-full border px-3 py-1.5"
                style={{ borderColor: selected ? colors.ink : colors.line, backgroundColor: selected ? colors.ink : '#FFFFFF' }}
              >
                <Text className="text-xs font-black" style={{ color: selected ? '#FFFFFF' : colors.ink }}>{option.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {field('Anything else about them (optional)', 'description', { placeholder: 'What they sell, why you like them', multiline: true })}

        <Text className="mt-5 text-sm font-black" style={{ color: colors.ink }}>How can we reach them?</Text>
        <Text className="text-xs" style={{ color: colors.muted }}>Add at least one.</Text>
        {field('Website', 'website', { placeholder: 'cornermarket.com', autoCapitalize: 'none', keyboardType: 'url' })}
        {field('Email', 'email', { placeholder: 'hello@cornermarket.com', autoCapitalize: 'none', keyboardType: 'email-address' })}
        {field('Phone', 'phone', { keyboardType: 'phone-pad' })}
        {field('City (optional)', 'city')}
        {field('How do you know them? (optional)', 'howKnown', { placeholder: 'I shop there every week', multiline: true })}

        {checkbox(mayName, () => setMayName((v) => !v), 'You can tell them I recommended them.')}
        {checkbox(confirmed, () => setConfirmed((v) => !v), "This is the business's public contact, or they're OK hearing from us.")}

        {message ? (
          <View accessibilityRole="alert" className="mt-4 rounded-2xl p-4" style={{ backgroundColor: message.tone === 'ok' ? colors.forestSoft : '#FEE4E2' }}>
            <Text className="text-sm font-semibold" style={{ color: message.tone === 'ok' ? colors.forest : colors.red }}>{message.text}</Text>
          </View>
        ) : null}

        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={submit} className="mt-4 items-center justify-center rounded-xl" style={{ backgroundColor: colors.ink, minHeight: 48, opacity: busy ? 0.6 : 1 }}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-black text-white">Send recommendation</Text>}
        </TouchableOpacity>

        {mine.length > 0 ? (
          <View className="mt-6">
            <Text className="text-lg font-black" style={{ color: colors.ink }}>Your recommendations</Text>
            {mine.map((referral) => (
              <View key={referral.id} className="mt-2 flex-row items-center rounded-2xl border bg-white p-3" style={{ borderColor: colors.line }}>
                <Store size={18} color={colors.orange} />
                <View className="ml-3 flex-1">
                  <Text className="font-black" style={{ color: colors.ink }}>{referral.businessName}</Text>
                  <Text className="text-xs" style={{ color: colors.muted }}>
                    {referral.categoryLabel ? `${referral.categoryLabel} · ` : ''}{referral.stage}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
