import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Lock, Plus, Sparkles, X } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type FamilySetupInput } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';

const THEME = {
  paper: '#F6F7F8',
  ink: '#111827',
  muted: '#6B7280',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  primaryBorder: '#FED7AA',
  border: '#E5E7EB',
  sage: '#0F766E',
  sageSoft: '#F0FDFA',
  sageBorder: '#99F6E4',
};

const ICONS = ['🏡', '🌳', '❤️', '🌻', '🍲', '🎉'];

/**
 * Starting points for what a family builds together. Each is something the
 * family owns or runs as a group, never one person's bills.
 */
const GOAL_IDEAS = [
  { label: 'Keep the family home in the family', hint: 'Taxes, repairs, or putting the deed somewhere safe' },
  { label: 'Start or grow a family business', hint: 'Equipment, permits, first supplies' },
  { label: 'Own more property together', hint: 'A rental or land the family holds' },
  { label: 'Buy in bulk and keep money in the family', hint: 'Shared buying for food, supplies or services' },
  { label: 'Pass something down to the next generation', hint: 'Land, a business or savings the kids inherit' },
  { label: 'Invest in a commons project together', hint: 'Back a project that pays the family back' },
];

const TIMEFRAMES = [
  { months: 6, label: '6 months' },
  { months: 12, label: '1 year' },
  { months: 24, label: '2 years' },
  { months: 60, label: '5 years' },
];

const VOTING_WINDOWS = [3, 7, 14] as const;
const MAX_GOALS = 6;
const MAX_HOUSE_RULES = 5;

type DraftGoal = { label: string; detail: string; amount: string; months?: number };
type Step = 1 | 2 | 3;

const usd = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;
const amountOf = (goal: DraftGoal) => {
  const value = Number(goal.amount.replace(/[^0-9.]/g, ''));
  return Number.isFinite(value) && value >= 1 ? Math.round(value) : undefined;
};

/**
 * Starts a private, invite-only family commons in three guided steps: what
 * the family will build together, making those goals concrete, and the
 * family agreement everyone accepts when they join. The creator is the
 * interim steward and lands on the invite screen to bring family in.
 *
 * Every step is optional except the name: skipped goals and mission stay
 * blank. With `?coopId=` the same steps edit an existing family's setup,
 * which its stewards can do only while everyone in the family is a steward.
 */
export default function CreateFamilyScreen() {
  const { sessionToken } = useAuth();
  const params = useLocalSearchParams<{ coopId?: string }>();
  const editCoopId = typeof params.coopId === 'string' && params.coopId ? params.coopId : null;
  const editing = !!editCoopId;
  const [step, setStep] = useState<Step>(1);
  const [loadingSetup, setLoadingSetup] = useState(editing);
  const [lockedReason, setLockedReason] = useState('');
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [iconEmoji, setIconEmoji] = useState(ICONS[0]);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [loadingIdeas, setLoadingIdeas] = useState(false);
  const [ideasError, setIdeasError] = useState('');

  const [goals, setGoals] = useState<DraftGoal[]>([]);
  const [customGoal, setCustomGoal] = useState('');

  const [mission, setMission] = useState('');
  const [votingWindowDays, setVotingWindowDays] = useState<3 | 7 | 14>(7);
  const [approval, setApproval] = useState<'MAJORITY' | 'TWO_THIRDS'>('MAJORITY');
  const [houseRules, setHouseRules] = useState<string[]>([]);
  const [newRule, setNewRule] = useState('');
  const [preview, setPreview] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Editing: start from the family's saved answers.
  useEffect(() => {
    if (!editCoopId || !sessionToken) return;
    let cancelled = false;
    setLoadingSetup(true);
    api
      .getFamilySetup(editCoopId, sessionToken)
      .then((view) => {
        if (cancelled) return;
        setName(view.name);
        setMission(view.setup.mission ?? '');
        setGoals(
          view.setup.goals.map((goal) => ({
            label: goal.label,
            detail: goal.detail ?? '',
            amount: goal.targetAmountUSD ? String(goal.targetAmountUSD) : '',
            months: goal.targetMonths,
          })),
        );
        setVotingWindowDays(view.setup.votingWindowDays);
        setApproval(view.setup.approval);
        setHouseRules(view.setup.houseRules);
        setLockedReason(view.canEdit ? '' : view.lockedReason ?? '');
      })
      .catch((err) => {
        if (!cancelled) setLoadError(friendlyError(err, "We couldn't load your family's setup."));
      })
      .finally(() => {
        if (!cancelled) setLoadingSetup(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editCoopId, sessionToken]);

  const leave = () => {
    if (router.canGoBack()) router.back();
    else if (editCoopId) router.replace({ pathname: '/commons/[coopId]', params: { coopId: editCoopId } } as any);
    else router.replace('/commons' as any);
  };

  const setup = (): FamilySetupInput => ({
    mission: mission.trim() || undefined,
    goals: goals.map((goal) => ({
      label: goal.label.trim(),
      detail: goal.detail.trim() || undefined,
      targetAmountUSD: amountOf(goal),
      targetMonths: goal.months,
    })),
    votingWindowDays,
    approval,
    houseRules,
  });

  // Any change to the answers makes an open preview stale.
  const touched = () => {
    if (preview) setPreview('');
    if (error) setError('');
  };

  const goTo = (next: Step) => {
    setError('');
    setStep(next);
  };

  const back = () => {
    if (step > 1 && !lockedReason && !loadError) return goTo((step - 1) as Step);
    leave();
  };

  // AI name ideas built from what's typed so far; every one is still free to use.
  const ideasLabel = loadingIdeas ? 'Thinking of names…' : ideas.length ? 'More ideas' : 'Suggest names';
  const suggestNames = async () => {
    if (!sessionToken || loadingIdeas) return;
    setLoadingIdeas(true);
    setIdeasError('');
    try {
      const result = await api.suggestFamilyNames(
        { currentName: name.trim() || undefined, description: description.trim() || undefined },
        sessionToken,
      );
      setIdeas(result.names);
      if (!result.names.length) setIdeasError('No free names this time. Add a little about your family and try again.');
    } catch (err) {
      setIdeasError(err instanceof Error ? err.message : "Couldn't come up with ideas right now.");
    } finally {
      setLoadingIdeas(false);
    }
  };

  const hasGoal = (label: string) => goals.some((goal) => goal.label.toLowerCase() === label.toLowerCase());
  const toggleGoal = (label: string) => {
    touched();
    setGoals((current) =>
      hasGoal(label)
        ? current.filter((goal) => goal.label.toLowerCase() !== label.toLowerCase())
        : current.length >= MAX_GOALS
          ? current
          : [...current, { label, detail: '', amount: '' }],
    );
  };
  const addCustomGoal = () => {
    const label = customGoal.trim();
    if (label.length < 2 || hasGoal(label) || goals.length >= MAX_GOALS) return;
    touched();
    setGoals((current) => [...current, { label, detail: '', amount: '' }]);
    setCustomGoal('');
  };
  const updateGoal = (index: number, changes: Partial<DraftGoal>) => {
    touched();
    setGoals((current) => current.map((goal, i) => (i === index ? { ...goal, ...changes } : goal)));
  };
  const moveGoal = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= goals.length) return;
    touched();
    setGoals((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const monthlyPace = goals.reduce((sum, goal) => {
    const amount = amountOf(goal);
    return amount && goal.months ? sum + amount / goal.months : sum;
  }, 0);

  const addRule = () => {
    const rule = newRule.trim();
    if (rule.length < 3 || houseRules.length >= MAX_HOUSE_RULES) return;
    touched();
    setHouseRules((current) => [...current, rule]);
    setNewRule('');
  };

  const showPreview = async () => {
    if (!sessionToken || loadingPreview) return;
    if (preview) return setPreview('');
    setLoadingPreview(true);
    setError('');
    try {
      const result = await api.previewFamilyAgreement(
        { name: name.trim(), setup: setup(), coopId: editCoopId ?? undefined },
        sessionToken,
      );
      setPreview(result.charterText);
    } catch (err) {
      setError(friendlyError(err, "We couldn't show the agreement right now."));
    } finally {
      setLoadingPreview(false);
    }
  };

  const nextFromName = () => {
    if (!editing && name.trim().length < 2) {
      setError('Give your family space a name.');
      return;
    }
    goTo(2);
  };

  /** Creates the family with whatever is answered so far; the rest stays blank. */
  const createNow = () => {
    if (name.trim().length < 2) {
      setError('Give your family space a name.');
      return;
    }
    void create();
  };

  const save = async () => {
    if (!sessionToken || !editCoopId || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.updateFamilySetup({ coopId: editCoopId, setup: setup() }, sessionToken);
      router.replace({ pathname: '/commons/[coopId]', params: { coopId: editCoopId } } as any);
    } catch (err) {
      setError(friendlyError(err, "We couldn't save your family's setup."));
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    if (!sessionToken || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.createFamilyCommons(
        { name: name.trim(), description: description.trim() || undefined, iconEmoji, setup: setup() },
        sessionToken,
      );
      router.replace({
        pathname: '/(authenticated)/commons-invites',
        params: { coopId: result.coopId },
      } as any);
    } catch (err) {
      console.error('Failed to create family commons:', err);
      const message = friendlyError(err, "We couldn't start your family.");
      // A taken name is fixed on the first step, next to the name field.
      if (/already taken/i.test(message)) setStep(1);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const titles: Record<Step, string> = {
    1: editing ? 'Family goals' : 'Start a family',
    2: 'Make it concrete',
    3: 'Family agreement',
  };
  const blocked = editing && (loadingSetup || !!lockedReason || !!loadError);

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: THEME.paper }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 }}
      >
        <View className="mb-4 flex-row items-center">
          <TouchableOpacity
            onPress={back}
            className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color={THEME.ink} />
          </TouchableOpacity>
          <View className="ml-3">
            <Text className="text-xs font-black uppercase text-gray-500">
              {editing ? `${name || 'Family'} setup` : 'Family'}
              {blocked ? '' : ` · step ${step} of 3`}
            </Text>
            <Text className="text-2xl font-black text-gray-950">
              {blocked ? 'Family setup' : titles[step]}
            </Text>
          </View>
        </View>

        {editing && loadingSetup ? (
          <View className="items-center py-10">
            <ActivityIndicator color={THEME.primary} />
          </View>
        ) : null}

        {editing && !loadingSetup && (lockedReason || loadError) ? (
          <View className="rounded-2xl border border-gray-200 bg-white p-4">
            <View className="flex-row items-center gap-2">
              <Lock size={18} color={THEME.muted} />
              <Text className="text-base font-black text-gray-950">
                {lockedReason ? "Stewards can't change this anymore" : "Couldn't load the setup"}
              </Text>
            </View>
            <Text className="mt-2 text-sm leading-5 text-gray-700">{lockedReason || loadError}</Text>
            <TouchableOpacity onPress={leave} accessibilityRole="button" className="mt-3 self-start">
              <Text className="text-sm font-black" style={{ color: THEME.primary }}>
                ← Back to the family
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!blocked && step === 1 ? (
          <>
            {editing ? (
              <Text className="mb-3 text-sm leading-5 text-gray-700">
                Change your family&apos;s goals, why you&apos;re doing this and how you decide.
                Everyone in the family sees the updated agreement.
              </Text>
            ) : null}
            {editing ? null : (
            <>
            <View
              className="mb-4 flex-row gap-3 rounded-2xl border p-4"
              style={{ borderColor: THEME.primaryBorder, backgroundColor: THEME.primarySoft }}
            >
              <Lock size={18} color={THEME.primary} />
              <Text className="min-w-0 flex-1 text-sm leading-5 text-gray-800">
                A family is private and invite-only. It never shows up in Explore, and only people you
                invite, or whose request you approve, can see who&apos;s there or anything posted.
              </Text>
            </View>

            <View className="rounded-2xl border border-gray-200 bg-white p-4">
              <Text className="text-sm font-black text-gray-900">What should we call your family?</Text>
              <Text className="mt-1 text-xs leading-4 text-gray-500">
                Any name works: a last name, a grandparent, a place or an inside joke. Every family
                needs its own name, so pick something only yours would use.
              </Text>
              <TextInput
                value={name}
                onChangeText={(value) => {
                  setName(value);
                  touched();
                }}
                placeholder="Grandma Mae's Crew"
                placeholderTextColor={THEME.muted}
                maxLength={60}
                accessibilityLabel="Family name"
                className="mt-2 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
              />
              {error ? <Text className="mt-2 text-sm font-semibold text-red-700">{error}</Text> : null}
              <TouchableOpacity
                onPress={suggestNames}
                disabled={loadingIdeas}
                accessibilityRole="button"
                accessibilityLabel={ideasLabel}
                className="mt-3 flex-row items-center self-start rounded-full border px-3 py-2"
                style={{ borderColor: THEME.primaryBorder, backgroundColor: THEME.primarySoft }}
              >
                {loadingIdeas ? (
                  <ActivityIndicator size="small" color={THEME.primary} />
                ) : (
                  <Sparkles size={14} color={THEME.primary} />
                )}
                <Text className="ml-2 text-xs font-bold" style={{ color: THEME.primary }}>
                  {ideasLabel}
                </Text>
              </TouchableOpacity>
              <Text className="mt-1 text-xs leading-4 text-gray-500">
                Ideas use the name and description you&apos;ve typed so far. Tap one, then make it yours.
              </Text>
              {ideasError ? <Text className="mt-2 text-xs font-semibold text-red-700">{ideasError}</Text> : null}
              {ideas.length ? (
                <View className="mt-2 flex-row flex-wrap gap-2">
                  {ideas.map((idea) => (
                    <TouchableOpacity
                      key={idea}
                      onPress={() => {
                        setName(idea);
                        touched();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Use the name ${idea}`}
                      className="rounded-full border px-3 py-2"
                      style={{
                        borderColor: name === idea ? THEME.primary : THEME.border,
                        backgroundColor: name === idea ? THEME.primarySoft : '#FFFFFF',
                      }}
                    >
                      <Text className="text-xs font-semibold text-gray-800">{idea}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              <Text className="mt-4 text-sm font-black text-gray-900">A short description (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Where we keep up with each other between reunions."
                placeholderTextColor={THEME.muted}
                maxLength={280}
                multiline
                accessibilityLabel="Family description"
                className="mt-2 min-h-20 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
                style={{ textAlignVertical: 'top' }}
              />

              <Text className="mt-4 text-sm font-black text-gray-900">Icon</Text>
              <View className="mt-2 flex-row flex-wrap gap-2">
                {ICONS.map((icon) => (
                  <TouchableOpacity
                    key={icon}
                    onPress={() => setIconEmoji(icon)}
                    accessibilityLabel={`Use ${icon} icon`}
                    accessibilityState={{ selected: iconEmoji === icon }}
                    aria-selected={iconEmoji === icon}
                    className="h-12 w-12 items-center justify-center rounded-xl border"
                    style={{
                      borderColor: iconEmoji === icon ? THEME.primary : THEME.border,
                      backgroundColor: iconEmoji === icon ? THEME.primarySoft : '#FFFFFF',
                    }}
                  >
                    <Text style={{ fontSize: 22, lineHeight: 28 }}>{icon}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            </>
            )}

            <View className={`${editing ? '' : 'mt-3 '}rounded-2xl border border-gray-200 bg-white p-4`}>
              <Text className="text-sm font-black text-gray-900">What will you build together?</Text>
              <Text className="mt-1 text-xs leading-5 text-gray-500">
                Pick things the family will own or run as a group, not any one person&apos;s bills.
                These become your family&apos;s goals, and every family proposal is weighed against
                them. Pick up to {MAX_GOALS}, or leave this blank and set it up later.
              </Text>
              <View className="mt-3 gap-2">
                {GOAL_IDEAS.map((idea) => {
                  const selected = hasGoal(idea.label);
                  return (
                    <GoalOption
                      key={idea.label}
                      label={idea.label}
                      hint={idea.hint}
                      selected={selected}
                      onPress={() => toggleGoal(idea.label)}
                    />
                  );
                })}
                {goals
                  .filter((goal) => !GOAL_IDEAS.some((idea) => idea.label === goal.label))
                  .map((goal) => (
                    <GoalOption key={goal.label} label={goal.label} selected onPress={() => toggleGoal(goal.label)} />
                  ))}
              </View>
              <View className="mt-3 flex-row items-center gap-2">
                <TextInput
                  value={customGoal}
                  onChangeText={setCustomGoal}
                  onSubmitEditing={addCustomGoal}
                  placeholder="Write your own"
                  placeholderTextColor={THEME.muted}
                  maxLength={80}
                  accessibilityLabel="Your own goal"
                  className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
                />
                <TouchableOpacity
                  onPress={addCustomGoal}
                  accessibilityRole="button"
                  accessibilityLabel="Add goal"
                  className="h-12 w-12 items-center justify-center rounded-xl border"
                  style={{ borderColor: THEME.primaryBorder, backgroundColor: THEME.primarySoft }}
                >
                  <Plus size={20} color={THEME.primary} />
                </TouchableOpacity>
              </View>
            </View>

            <PrimaryButton label="Next: make it concrete" onPress={nextFromName} />
            {editing ? null : (
              <TouchableOpacity
                onPress={createNow}
                disabled={saving}
                accessibilityRole="button"
                className="mt-3 items-center py-2"
              >
                <Text className="text-sm font-black" style={{ color: THEME.primary }}>
                  {saving ? 'Creating…' : 'Skip for now and create the family'}
                </Text>
              </TouchableOpacity>
            )}
            {editing ? null : (
              <Text className="mt-1 text-center text-xs leading-4 text-gray-500">
                Goals and the family&apos;s mission stay blank until you set them up from the
                family&apos;s page. Votes stay open 7 days and pass with more than half.
              </Text>
            )}
          </>
        ) : null}

        {!blocked && step === 2 ? (
          <>
            <Text className="mb-3 text-sm leading-5 text-gray-700">
              Give each goal a number and a timeframe if you know them. The order is the priority:
              the first goal counts most when the family weighs a proposal. All of this is optional.
            </Text>

            {goals.length === 0 ? (
              <View className="rounded-2xl border border-gray-200 bg-white p-4">
                <Text className="text-sm font-black text-gray-900">No goals yet</Text>
                <Text className="mt-1 text-sm leading-5 text-gray-600">
                  That&apos;s fine. Your family&apos;s goals stay blank until you set them, and a
                  steward can add them any time from the family&apos;s page.
                </Text>
                <TouchableOpacity onPress={() => goTo(1)} accessibilityRole="button" className="mt-3 self-start">
                  <Text className="text-sm font-black" style={{ color: THEME.primary }}>
                    ← Pick goals
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="gap-3">
                {goals.map((goal, index) => (
                  <View key={goal.label} className="rounded-2xl border border-gray-200 bg-white p-4">
                    <View className="flex-row items-start gap-2">
                      <View
                        className="h-7 w-7 items-center justify-center rounded-full"
                        style={{ backgroundColor: THEME.primarySoft }}
                      >
                        <Text className="text-xs font-black" style={{ color: THEME.primary }}>
                          {index + 1}
                        </Text>
                      </View>
                      <Text className="min-w-0 flex-1 text-base font-black text-gray-950">{goal.label}</Text>
                      <IconButton
                        label={`Move ${goal.label} up`}
                        disabled={index === 0}
                        onPress={() => moveGoal(index, -1)}
                      >
                        <ArrowUp size={16} color={index === 0 ? '#D1D5DB' : THEME.ink} />
                      </IconButton>
                      <IconButton
                        label={`Move ${goal.label} down`}
                        disabled={index === goals.length - 1}
                        onPress={() => moveGoal(index, 1)}
                      >
                        <ArrowDown size={16} color={index === goals.length - 1 ? '#D1D5DB' : THEME.ink} />
                      </IconButton>
                    </View>

                    <Text className="mt-3 text-xs font-bold text-gray-600">What it takes (optional)</Text>
                    <TextInput
                      value={goal.detail}
                      onChangeText={(detail) => updateGoal(index, { detail })}
                      placeholder={GOAL_IDEAS.find((idea) => idea.label === goal.label)?.hint ?? 'The first steps'}
                      placeholderTextColor={THEME.muted}
                      maxLength={160}
                      accessibilityLabel={`What ${goal.label} takes`}
                      className="mt-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900"
                    />

                    <Text className="mt-3 text-xs font-bold text-gray-600">Target amount (optional)</Text>
                    <TextInput
                      value={goal.amount}
                      onChangeText={(amount) => updateGoal(index, { amount: amount.replace(/[^0-9,]/g, '') })}
                      placeholder="$5,000"
                      placeholderTextColor={THEME.muted}
                      keyboardType="number-pad"
                      maxLength={11}
                      accessibilityLabel={`Target amount for ${goal.label}`}
                      className="mt-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-900"
                    />

                    <Text className="mt-3 text-xs font-bold text-gray-600">Within</Text>
                    <View className="mt-1 flex-row flex-wrap gap-2">
                      {TIMEFRAMES.map((option) => {
                        const selected = goal.months === option.months;
                        return (
                          <TouchableOpacity
                            key={option.months}
                            onPress={() => updateGoal(index, { months: selected ? undefined : option.months })}
                            accessibilityRole="button"
                            accessibilityLabel={`${goal.label} within ${option.label}`}
                            accessibilityState={{ selected }}
                            aria-selected={selected}
                            className="rounded-full border px-3 py-2"
                            style={{
                              borderColor: selected ? THEME.primary : THEME.border,
                              backgroundColor: selected ? THEME.primarySoft : '#FFFFFF',
                            }}
                          >
                            <Text className="text-xs font-bold text-gray-800">{option.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))}

                {monthlyPace > 0 ? (
                  <View
                    className="flex-row gap-2.5 rounded-2xl border p-4"
                    style={{ borderColor: THEME.sageBorder, backgroundColor: THEME.sageSoft }}
                  >
                    <Sparkles size={16} color={THEME.sage} />
                    <Text className="min-w-0 flex-1 text-sm leading-5" style={{ color: '#134E4A' }}>
                      Hitting every target on time takes about{' '}
                      <Text className="font-black" style={{ color: '#134E4A' }}>
                        {usd(monthlyPace)} a month
                      </Text>{' '}
                      across the family. If that&apos;s too much to start, move the goal that
                      can&apos;t wait to the top and give the rest more time.
                    </Text>
                  </View>
                ) : null}
              </View>
            )}

            <PrimaryButton label="Next: family agreement" onPress={() => goTo(3)} />
          </>
        ) : null}

        {!blocked && step === 3 ? (
          <>
            <Text className="mb-3 text-sm leading-5 text-gray-700">
              This is your family&apos;s constitution. Everyone you invite reads it and agrees to it
              before they join. Stewards can change it while everyone in the family is a steward;
              after that, changing it is a family decision.
            </Text>

            <View className="rounded-2xl border border-gray-200 bg-white p-4">
              <Text className="text-sm font-black text-gray-900">Why you&apos;re doing this (optional)</Text>
              <Text className="mt-1 text-xs leading-4 text-gray-500">
                One or two sentences your family can rally around.
              </Text>
              <TextInput
                value={mission}
                onChangeText={(value) => {
                  setMission(value);
                  touched();
                }}
                placeholder="Keep what Grandma built in the family and build more of it together."
                placeholderTextColor={THEME.muted}
                maxLength={280}
                multiline
                accessibilityLabel="Family mission"
                className="mt-2 min-h-20 rounded-xl border border-gray-200 px-3 py-3 text-base text-gray-900"
                style={{ textAlignVertical: 'top' }}
              />
            </View>

            <View className="mt-3 rounded-2xl border border-gray-200 bg-white p-4">
              <Text className="text-sm font-black text-gray-900">How the family decides</Text>
              <Text className="mt-1 text-xs leading-4 text-gray-500">
                At least half the family has to vote on a family decision for it to count.
              </Text>
              <Text className="mt-3 text-xs font-bold text-gray-600">Votes stay open for</Text>
              <Segmented
                options={VOTING_WINDOWS.map((days) => ({ value: days, label: `${days} days` }))}
                value={votingWindowDays}
                onChange={(days) => {
                  setVotingWindowDays(days);
                  touched();
                }}
              />
              <Text className="mt-3 text-xs font-bold text-gray-600">A decision passes with</Text>
              <Segmented
                options={[
                  { value: 'MAJORITY' as const, label: 'More than half' },
                  { value: 'TWO_THIRDS' as const, label: 'Two-thirds' },
                ]}
                value={approval}
                onChange={(value) => {
                  setApproval(value);
                  touched();
                }}
              />
            </View>

            <View className="mt-3 rounded-2xl border border-gray-200 bg-white p-4">
              <Text className="text-sm font-black text-gray-900">Already in every family agreement</Text>
              <View className="mt-2 gap-2">
                <Rule text="Money the family pools goes only to things it owns or runs together. Personal bills and loans stay between people." />
                <Rule
                  text={
                    editing
                      ? "Whoever started the family is the interim steward until the family elects its stewards."
                      : "You're the interim steward until the family elects its stewards."
                  }
                />
                <Rule text="The family is private: ask before sharing anything from it." />
                <Rule text="Be kind. Disagree about ideas, not about people." />
                <Rule text="Anyone can leave at any time." />
              </View>
            </View>

            <View className="mt-3 rounded-2xl border border-gray-200 bg-white p-4">
              <Text className="text-sm font-black text-gray-900">Your own house rules (optional)</Text>
              {houseRules.length ? (
                <View className="mt-2 gap-2">
                  {houseRules.map((rule, index) => (
                    <View key={`${rule}-${index}`} className="flex-row items-center gap-2">
                      <Text className="min-w-0 flex-1 text-sm leading-5 text-gray-800">{rule}</Text>
                      <IconButton
                        label={`Remove rule ${rule}`}
                        onPress={() => {
                          touched();
                          setHouseRules((current) => current.filter((_, i) => i !== index));
                        }}
                      >
                        <X size={16} color={THEME.muted} />
                      </IconButton>
                    </View>
                  ))}
                </View>
              ) : null}
              {houseRules.length < MAX_HOUSE_RULES ? (
                <View className="mt-2 flex-row items-center gap-2">
                  <TextInput
                    value={newRule}
                    onChangeText={setNewRule}
                    onSubmitEditing={addRule}
                    placeholder="No business talk at Sunday dinner."
                    placeholderTextColor={THEME.muted}
                    maxLength={200}
                    accessibilityLabel="New house rule"
                    className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-3 text-sm text-gray-900"
                  />
                  <TouchableOpacity
                    onPress={addRule}
                    accessibilityRole="button"
                    accessibilityLabel="Add rule"
                    className="h-12 w-12 items-center justify-center rounded-xl border"
                    style={{ borderColor: THEME.primaryBorder, backgroundColor: THEME.primarySoft }}
                  >
                    <Plus size={20} color={THEME.primary} />
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            <TouchableOpacity
              onPress={showPreview}
              disabled={loadingPreview}
              accessibilityRole="button"
              className="mt-3 flex-row items-center justify-center rounded-xl border bg-white py-3"
              style={{ borderColor: THEME.border }}
            >
              {loadingPreview ? (
                <ActivityIndicator size="small" color={THEME.primary} />
              ) : (
                <Text className="text-sm font-black text-gray-900">
                  {preview ? 'Hide the full agreement' : 'Read the full agreement'}
                </Text>
              )}
            </TouchableOpacity>
            {preview ? (
              <View className="mt-2 rounded-2xl border border-gray-200 bg-white p-4">
                <Text className="text-sm leading-6 text-gray-800">{preview.replace(/^#\s*/, '')}</Text>
              </View>
            ) : null}

            {error ? <Text className="mt-4 text-sm font-semibold text-red-700">{error}</Text> : null}

            {editing ? (
              <PrimaryButton label="Save changes" onPress={save} loading={saving} />
            ) : (
              <>
                <PrimaryButton label="Create family" onPress={create} loading={saving} />
                <Text className="mt-3 text-center text-xs leading-4 text-gray-500">
                  You&apos;ll be its interim steward: you invite family members and approve requests
                  until the family elects its stewards.
                </Text>
              </>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function GoalOption({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      accessibilityLabel={label}
      className="flex-row items-center gap-3 rounded-xl border px-3 py-3"
      style={{
        borderColor: selected ? THEME.primary : THEME.border,
        backgroundColor: selected ? THEME.primarySoft : '#FFFFFF',
      }}
    >
      <View
        className="h-5 w-5 items-center justify-center rounded-md border-2"
        style={{
          borderColor: selected ? THEME.primary : '#9CA3AF',
          backgroundColor: selected ? THEME.primary : '#FFFFFF',
        }}
      >
        {selected ? <Check size={12} color="#FFFFFF" strokeWidth={3} /> : null}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-bold text-gray-900">{label}</Text>
        {hint ? <Text className="mt-0.5 text-xs text-gray-500">{hint}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="mt-1 flex-row gap-1 rounded-xl bg-gray-100 p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <TouchableOpacity
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            aria-checked={selected}
            accessibilityLabel={option.label}
            className="h-10 flex-1 items-center justify-center rounded-lg"
            style={{ backgroundColor: selected ? '#FFFFFF' : 'transparent' }}
          >
            <Text className={`text-xs font-black ${selected ? 'text-gray-950' : 'text-gray-500'}`}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Rule({ text }: { text: string }) {
  return (
    <View className="flex-row gap-2">
      <Check size={16} color={THEME.sage} />
      <Text className="min-w-0 flex-1 text-sm leading-5 text-gray-700">{text}</Text>
    </View>
  );
}

function IconButton({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white"
    >
      {children}
    </TouchableOpacity>
  );
}

function PrimaryButton({ label, onPress, loading }: { label: string; onPress: () => void; loading?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      className="mt-5 items-center rounded-xl py-3.5"
      style={{ backgroundColor: THEME.primary, opacity: loading ? 0.6 : 1 }}
    >
      {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-black text-white">{label}</Text>}
    </TouchableOpacity>
  );
}
