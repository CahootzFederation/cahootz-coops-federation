import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, HandHeart, Lightbulb, MessageCircle, UserCircle, Users } from 'lucide-react-native';

import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

const MIN_SELF_DESCRIPTION = 40;
const MIN_SIGNAL_ITEMS = 1;

type ListFieldName = 'interests' | 'resourcesOffered' | 'resourcesNeeded';
type OptionalFieldName = 'goals' | 'businessSummary' | 'locationSummary';
type WizardStep = 'intro' | 'profile';

type FieldConfig = {
  label: string;
  helper: string;
  placeholder: string;
  minChars: number;
  minHeight: number;
};

const introField: FieldConfig = {
  label: 'Short intro',
  helper: 'A few sentences is enough. Share who you are and what you care about.',
  placeholder: 'I live in East Oakland and care about food access, music, and helping neighbors connect.',
  minChars: MIN_SELF_DESCRIPTION,
  minHeight: 120,
};

const signalFields: {
  name: ListFieldName;
  label: string;
  helper: string;
  placeholder: string;
  minItems: number;
  maxItemLength: number;
}[] = [
  {
    name: 'interests',
    label: 'Interests',
    helper: 'What do you want to hear about or connect around?',
    placeholder: 'music, housing, food, wellness, events',
    minItems: MIN_SIGNAL_ITEMS,
    maxItemLength: 80,
  },
  {
    name: 'resourcesOffered',
    label: 'What you can offer',
    helper: 'This can be skills, time, tools, space, rides, advice, or encouragement.',
    placeholder: 'childcare, rides, cooking, design help',
    minItems: MIN_SIGNAL_ITEMS,
    maxItemLength: 120,
  },
  {
    name: 'resourcesNeeded',
    label: "What you're looking for",
    helper: 'Share what would help you, your family, or something you are working on.',
    placeholder: 'job leads, event space, repair help, collaborators',
    minItems: MIN_SIGNAL_ITEMS,
    maxItemLength: 120,
  },
];

const appIntroItems = [
  {
    title: 'Post on your community feeds',
    body: 'Introduce yourself, ask a question, share an idea, or tell people what you are working on.',
    Icon: MessageCircle,
  },
  {
    title: 'Join commons',
    body: 'Commons are shared spaces where people with a real connection can post, ask for help, offer support, plan things, and build trust over time.',
    Icon: Users,
  },
  {
    title: 'Ask for help and offer help',
    body: 'People can share needs, skills, time, tools, advice, rides, space, or support.',
    Icon: HandHeart,
  },
  {
    title: 'Turn good conversations into action',
    body: 'Start simple. A useful post can become a meetup, project, event, service, or local connection.',
    Icon: Lightbulb,
  },
] as const;

function parseSignalList(value: string, maxItemLength = 120) {
  return Array.from(
    new Set(
      value
        .split(/[\n,;•]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.slice(0, maxItemLength))
    )
  ).slice(0, 30);
}

export default function ProfileOnboardingScreen() {
  const { user, sessionToken, isLoading, login, deferProfileOnboarding } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const [step, setStep] = useState<WizardStep>('intro');
  const [selfDescription, setSelfDescription] = useState(user?.selfDescription || '');
  const [signalValues, setSignalValues] = useState<Record<ListFieldName, string>>({
    interests: user?.interests?.join(', ') || '',
    resourcesOffered: user?.resourcesOffered?.join(', ') || '',
    resourcesNeeded: user?.resourcesNeeded?.join(', ') || '',
  });
  const [optionalValues, setOptionalValues] = useState<Record<OptionalFieldName, string>>({
    goals: user?.shortTermGoals || user?.longTermGoals || '',
    businessSummary: user?.businessSummary || '',
    locationSummary: user?.locationSummary || '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
    }
  }, [isLoading, user]);

  const introComplete = selfDescription.trim().length >= introField.minChars;

  const signalProgress = useMemo(() => {
    return signalFields.reduce<Record<ListFieldName, { count: number; complete: boolean }>>((acc, field) => {
      const count = parseSignalList(signalValues[field.name], field.maxItemLength).length;
      acc[field.name] = {
        count,
        complete: count >= field.minItems,
      };
      return acc;
    }, {} as Record<ListFieldName, { count: number; complete: boolean }>);
  }, [signalValues]);

  const canSubmit =
    introComplete &&
    signalFields.every((field) => signalProgress[field.name].complete) &&
    !!sessionToken &&
    !!user;

  const updateIntro = (value: string) => {
    setSelfDescription(value);
    setError('');
  };

  const updateSignalField = (name: ListFieldName, value: string) => {
    setSignalValues((current) => ({ ...current, [name]: value }));
    setError('');
  };

  const updateOptionalField = (name: OptionalFieldName, value: string) => {
    setOptionalValues((current) => ({ ...current, [name]: value }));
    setError('');
  };

  const goToStep = async (nextStep: WizardStep) => {
    if (nextStep === 'profile') {
      try {
        await deferProfileOnboarding();
      } catch (err) {
        console.error('Profile onboarding seen-state save failed:', err);
      }
    }

    setStep(nextStep);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  };

  const handleSkip = async () => {
    if (!user || isSaving) return;

    try {
      await deferProfileOnboarding();
      router.replace({ pathname: '/(tabs)', params: { welcome: '1' } } as any);
    } catch (err) {
      console.error('Profile onboarding skip failed:', err);
      setError('Could not skip right now. Try again.');
    }
  };

  const handleSubmit = async () => {
    if (!user || !sessionToken || isSaving) return;

    if (!introComplete) {
      setError('Your short intro needs a little more detail before you continue.');
      return;
    }

    const missingSignalField = signalFields.find((field) => !signalProgress[field.name].complete);
    if (missingSignalField) {
      setError(`${missingSignalField.label} needs at least ${missingSignalField.minItems} item before you continue.`);
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const result = await api.completeProfileOnboarding(
        {
          selfDescription: selfDescription.trim(),
          goals: optionalValues.goals.trim(),
          interests: parseSignalList(signalValues.interests, 80),
          resourcesOffered: parseSignalList(signalValues.resourcesOffered, 120),
          resourcesNeeded: parseSignalList(signalValues.resourcesNeeded, 120),
          businessSummary: optionalValues.businessSummary.trim(),
          locationSummary: optionalValues.locationSummary.trim(),
        },
        sessionToken
      );

      await login({
        ...user,
        ...result.user,
        createdAt: new Date(result.user.createdAt),
        profileOnboardingCompletedAt: result.user.profileOnboardingCompletedAt
          ? new Date(result.user.profileOnboardingCompletedAt)
          : new Date(),
        sessionToken,
        coop: user.coop,
      });

      router.replace({ pathname: '/(tabs)', params: { welcome: '1' } } as any);
    } catch (err) {
      console.error('Profile onboarding save failed:', err);
      setError(err instanceof Error ? err.message : 'Could not save your profile. Try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !user) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color="#FF6B00" size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {step === 'intro' ? (
            <>
          <View style={styles.header}>
            <View style={styles.stepPill}>
              <Text style={styles.stepPillText}>Step 1 of 2</Text>
            </View>
            <View style={styles.badge}>
              <UserCircle color="#FF6B00" size={18} strokeWidth={2.4} />
              <Text style={styles.badgeText}>Welcome to Cahootz</Text>
            </View>
            <Text style={styles.title}>A community app for everyday help and action</Text>
            <Text style={styles.subtitle}>
              Cahootz is a place to meet people, share what you need, offer what you can, and start real conversations.
            </Text>
          </View>

          <View style={styles.appIntro}>
            {appIntroItems.map(({ title, body, Icon }) => (
              <View key={title} style={styles.appIntroRow}>
                <View style={styles.appIntroIcon}>
                  <Icon color="#FF6B00" size={18} strokeWidth={2.5} />
                </View>
                <View style={styles.appIntroText}>
                  <Text style={styles.appIntroTitle}>{title}</Text>
                  <Text style={styles.appIntroBody}>{body}</Text>
                </View>
              </View>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => goToStep('profile')}
            style={({ pressed }) => [
              styles.submitButton,
              pressed && styles.submitButtonPressed,
            ]}
          >
            <Text style={styles.submitText}>Continue</Text>
            <ArrowRight color="#FFFFFF" size={20} strokeWidth={2.6} />
          </Pressable>
            </>
          ) : (
            <>
          <View style={styles.wizardTop}>
            <Pressable
              accessibilityRole="button"
              onPress={() => goToStep('intro')}
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.backButtonPressed,
              ]}
            >
              <ArrowLeft color="#475569" size={18} strokeWidth={2.5} />
              <Text style={styles.backButtonText}>Back</Text>
            </Pressable>
            <View style={[styles.stepPill, styles.stepPillFlush]}>
              <Text style={styles.stepPillText}>Step 2 of 2</Text>
            </View>
          </View>

          <View style={styles.profileIntro}>
            <Text style={styles.sectionEyebrow}>Before your first post</Text>
            <Text style={styles.sectionTitle}>Build your profile</Text>
            <Text style={styles.sectionBody}>
              These answers help people understand who you are and make your first post easier. You can change them later.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.fieldBlock}>
              <View style={styles.fieldHeader}>
                <Text style={styles.label}>{introField.label}</Text>
                <Text style={[styles.counter, introComplete && styles.counterComplete]}>
                  {introComplete ? 'Ready' : `${Math.max(introField.minChars - selfDescription.trim().length, 0)} more`}
                </Text>
              </View>
              <Text style={styles.helper}>{introField.helper}</Text>
              <TextInput
                value={selfDescription}
                onChangeText={updateIntro}
                placeholder={introField.placeholder}
                placeholderTextColor="#9CA3AF"
                multiline
                textAlignVertical="top"
                style={[styles.input, { minHeight: introField.minHeight }]}
              />
            </View>

            <View style={styles.signalGrid}>
              {signalFields.map((field) => {
                const progress = signalProgress[field.name];

                return (
                  <View key={field.name} style={styles.fieldBlock}>
                    <View style={styles.fieldHeader}>
                      <Text style={styles.label}>{field.label}</Text>
                      <Text style={[styles.counter, progress.complete && styles.counterComplete]}>
                        {progress.complete ? `${progress.count} added` : 'Add one'}
                      </Text>
                    </View>
                    <Text style={styles.helper}>{field.helper}</Text>
                    <TextInput
                      value={signalValues[field.name]}
                      onChangeText={(value) => updateSignalField(field.name, value)}
                      placeholder={field.placeholder}
                      placeholderTextColor="#9CA3AF"
                      multiline
                      textAlignVertical="top"
                      style={[styles.input, styles.signalInput]}
                    />
                  </View>
                );
              })}
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.label}>Goals</Text>
              <Text style={styles.helper}>
                Optional. Share something you want to work on, learn, organize, or move forward.
              </Text>
              <TextInput
                value={optionalValues.goals}
                onChangeText={(value) => updateOptionalField('goals', value)}
                placeholder="I want to meet collaborators, find steady work, and help plan more community events."
                placeholderTextColor="#9CA3AF"
                multiline
                textAlignVertical="top"
                style={[styles.input, styles.optionalInput]}
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.label}>Business or work</Text>
              <Text style={styles.helper}>
                Optional. Add what you do, make, sell, study, or want people to know about your work.
              </Text>
              <TextInput
                value={optionalValues.businessSummary}
                onChangeText={(value) => updateOptionalField('businessSummary', value)}
                placeholder="I run a small catering business, freelance as..."
                placeholderTextColor="#9CA3AF"
                multiline
                textAlignVertical="top"
                style={[styles.input, styles.optionalInput]}
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.label}>Neighborhood or region</Text>
              <Text style={styles.helper}>
                Optional. Keep it general if you want: city, neighborhood, or region.
              </Text>
              <TextInput
                value={optionalValues.locationSummary}
                onChangeText={(value) => updateOptionalField('locationSummary', value)}
                placeholder="East Oakland, Atlanta, South LA..."
                placeholderTextColor="#9CA3AF"
                style={styles.input}
              />
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit || isSaving}
            onPress={handleSubmit}
            style={({ pressed }) => [
              styles.submitButton,
              (!canSubmit || isSaving) && styles.submitButtonDisabled,
              pressed && canSubmit && !isSaving && styles.submitButtonPressed,
            ]}
          >
            {isSaving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.submitText}>Start using Cahootz</Text>
                <ArrowRight color="#FFFFFF" size={20} strokeWidth={2.6} />
              </>
            )}
          </Pressable>
          <Pressable accessibilityRole="button" disabled={isSaving} onPress={handleSkip} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Do this later</Text>
          </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  keyboardView: {
    flex: 1,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  header: {
    paddingTop: 8,
    paddingBottom: 18,
  },
  wizardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 18,
  },
  stepPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 14,
  },
  stepPillFlush: {
    marginBottom: 0,
  },
  stepPillText: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  backButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
  },
  backButtonPressed: {
    opacity: 0.72,
  },
  backButtonText: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 18,
  },
  badgeText: {
    color: '#C2410C',
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    color: '#0F172A',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: 0,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
  },
  appIntro: {
    gap: 10,
    marginBottom: 20,
  },
  appIntroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F0F2F5',
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  appIntroIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7ED',
  },
  appIntroText: {
    flex: 1,
    minWidth: 0,
  },
  appIntroTitle: {
    color: '#0F172A',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  appIntroBody: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  profileIntro: {
    borderTopWidth: 1,
    borderTopColor: '#F0F2F5',
    paddingTop: 18,
    marginBottom: 14,
  },
  sectionEyebrow: {
    color: '#FF6B00',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    marginTop: 6,
  },
  sectionBody: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
  },
  form: {
    gap: 18,
  },
  fieldBlock: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F0F2F5',
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    flex: 1,
    color: '#0F172A',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  counter: {
    color: '#FF6B00',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  counterComplete: {
    color: '#16A34A',
  },
  helper: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 12,
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  signalGrid: {
    gap: 12,
  },
  signalInput: {
    minHeight: 88,
  },
  optionalInput: {
    minHeight: 104,
  },
  error: {
    color: '#DC2626',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 16,
  },
  submitButton: {
    minHeight: 58,
    borderRadius: 16,
    backgroundColor: '#FF6B00',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 22,
    marginBottom: 12,
  },
  submitButtonDisabled: {
    opacity: 0.45,
  },
  submitButtonPressed: {
    transform: [{ scale: 0.99 }],
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  secondaryButtonText: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
});
