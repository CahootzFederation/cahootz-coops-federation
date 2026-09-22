import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { ArrowRight, Compass, HandHeart, Lightbulb, MessageCircle, UserCircle, Users } from 'lucide-react-native';

import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import { getOrCreateAnonymousId, markAnonymousProfileIntroSeen } from '@/lib/anonymous-id';
import { secureStorage } from '@/lib/secure-storage';

const MIN_SELF_DESCRIPTION = 40;
const MIN_SIGNAL_ITEMS = 1;
const INTRO_CAROUSEL_INTERVAL_MS = 4500;

const appIntroItems = [
  {
    title: 'Post on your community feeds',
    body: 'Introduce yourself, ask a question, share an idea, or tell people what you are working on.',
    visual: '💬',
    visualBg: '#EFF6FF',
    Icon: MessageCircle,
  },
  {
    title: 'Join commons',
    body: 'Commons are shared spaces where people with a real connection can post, ask for help, offer support, plan things, and build trust over time.',
    visual: '🤝',
    visualBg: '#F0FDF4',
    Icon: Users,
  },
  {
    title: 'Ask for help and offer help',
    body: 'People can share needs, skills, time, tools, advice, rides, space, or support.',
    visual: '🛠️',
    visualBg: '#FFF7ED',
    Icon: HandHeart,
  },
  {
    title: 'Turn good conversations into action',
    body: 'Start simple. A useful post can become a meetup, project, event, service, or local connection.',
    visual: '💡',
    visualBg: '#FEFCE8',
    Icon: Lightbulb,
  },
] as const;

type WizardStep = 'intro' | 'profile' | 'circles';
type ListFieldName = 'interests' | 'resourcesOffered' | 'resourcesNeeded';
type OptionalFieldName = 'goals' | 'businessSummary' | 'locationSummary';

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

// The Welcome Wizard: an app-intro carousel followed by a "build your
// profile" form, always shown in that order. This single page handles both
// entry points — a fresh anonymous visitor (routed here from app/index.tsx
// before they've signed in at all) and an existing account finishing
// onboarding after login (routed here by AuthContext's navigation effect).
// Anonymous visitors save against a device-generated id instead of a user
// record; that data gets migrated onto their account automatically once
// they do sign in (see verifyLoginCode in packages/trpc/src/routers/auth.ts).
export default function ProfileOnboardingScreen() {
  const { user, sessionToken, isLoading, login, deferProfileOnboarding } = useAuth();
  const [wizardStep, setWizardStep] = useState<WizardStep>('intro');

  const { width } = useWindowDimensions();
  const introCarouselRef = useRef<ScrollView>(null);
  const [introCarouselIndex, setIntroCarouselIndex] = useState(0);
  const introCardWidth = Math.max(width - 40, 280);

  useEffect(() => {
    if (wizardStep !== 'intro') return;

    const interval = setInterval(() => {
      setIntroCarouselIndex((currentIndex) => {
        const nextIndex = (currentIndex + 1) % appIntroItems.length;
        introCarouselRef.current?.scrollTo({ x: nextIndex * introCardWidth, animated: true });
        return nextIndex;
      });
    }, INTRO_CAROUSEL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [introCardWidth, wizardStep]);

  const updateIntroCarouselIndex = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / introCardWidth);
    setIntroCarouselIndex(Math.min(Math.max(nextIndex, 0), appIntroItems.length - 1));
  };

  const goToIntroSlide = (index: number) => {
    introCarouselRef.current?.scrollTo({ x: index * introCardWidth, animated: true });
    setIntroCarouselIndex(index);
  };

  const scrollRef = useRef<ScrollView>(null);
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
  const [profileResult, setProfileResult] = useState<Awaited<
    ReturnType<typeof api.completeProfileOnboarding>
  > | null>(null);
  const [isJoiningWelcomeTable, setIsJoiningWelcomeTable] = useState(false);

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
    introComplete && signalFields.every((field) => signalProgress[field.name].complete);

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

  const handleSkip = async () => {
    if (isSaving) return;

    if (!user) {
      // Anonymous visitors still see the newcomer-home step - only the
      // account-only actions on it (join a welcome table) require signing
      // in, same as any other authenticated action in the app.
      void markAnonymousProfileIntroSeen();
      setWizardStep('circles');
      return;
    }

    try {
      await deferProfileOnboarding();
      // Skipping the profile form only skips the form - still show the
      // newcomer-home step so people get a real first action, matching
      // "Skip" on the circles step itself for opting out of that too.
      setWizardStep('circles');
    } catch (err) {
      console.error('Profile onboarding skip failed:', err);
      setError('Could not skip right now. Try again.');
    }
  };

  // Finishes the wizard and navigates on. If the profile form was actually
  // submitted (profileResult set), this also marks profileOnboardingCompletedAt
  // via login() - which is what lets AuthContext's own redirect-out effect
  // send us to /(tabs); see the note on the 'circles' step below for why
  // that only happens now, not right after the profile form saves. If the
  // profile form was skipped instead, deferProfileOnboarding() (called in
  // handleSkip) already lets us navigate freely, so there's nothing more to persist here.
  const completeOnboarding = async (destination: { pathname: string; params?: Record<string, string> }) => {
    if (!user || !sessionToken) {
      void markAnonymousProfileIntroSeen();
      router.replace('/' as any);
      return;
    }

    if (profileResult) {
      await login({
        ...user,
        ...profileResult.user,
        createdAt: new Date(profileResult.user.createdAt),
        profileOnboardingCompletedAt: profileResult.user.profileOnboardingCompletedAt
          ? new Date(profileResult.user.profileOnboardingCompletedAt)
          : new Date(),
        sessionToken,
        coop: user.coop,
      });
    }

    router.replace(destination as any);
  };

  const handleJoinWelcomeTable = async () => {
    if (isJoiningWelcomeTable) return;

    if (!user || !sessionToken) {
      // Joining a table is an account action - send anonymous visitors to
      // sign in rather than silently failing the API call.
      void markAnonymousProfileIntroSeen();
      router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
      return;
    }

    setIsJoiningWelcomeTable(true);
    try {
      const result = await api.assignWelcomeTable(sessionToken);
      await completeOnboarding({
        pathname: '/[coopId]/posts',
        params: { coopId: 'cahootz', circleId: result.groupId },
      });
    } catch (err) {
      console.error('Could not join a welcome lounge:', err);
      setError('Could not join a welcome lounge right now. Try exploring on your own instead.');
    } finally {
      setIsJoiningWelcomeTable(false);
    }
  };

  // Auto-join a welcome lounge once a brand-new account reaches this step, if
  // they expressed that intent before creating the account (tapping "Join a
  // welcome lounge" on Circle View while signed out - see circle-view.tsx).
  // Consumed once and cleared immediately so it never fires again for this
  // device (e.g. on a later, unrelated signup).
  useEffect(() => {
    if (wizardStep !== 'circles' || !user || !sessionToken) return;

    let cancelled = false;
    secureStorage.getItem(secureStorage.keys.WELCOME_TABLE_INTENT).then((intent) => {
      if (!intent || cancelled) return;
      void secureStorage.removeItem(secureStorage.keys.WELCOME_TABLE_INTENT);
      void handleJoinWelcomeTable();
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardStep, user, sessionToken]);

  const handleExploreOnMyOwn = () => {
    void completeOnboarding({ pathname: '/commons' });
  };

  const handleSkipCircles = () => {
    void completeOnboarding({ pathname: '/(tabs)', params: { welcome: '1' } });
  };

  const handleSubmit = async () => {
    if (isSaving) return;

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
      if (!user || !sessionToken) {
        const anonymousId = await getOrCreateAnonymousId();
        await api.saveAnonymousProfile({
          anonymousId,
          selfDescription: selfDescription.trim(),
          goals: optionalValues.goals.trim(),
          interests: parseSignalList(signalValues.interests, 80),
          resourcesOffered: parseSignalList(signalValues.resourcesOffered, 120),
          resourcesNeeded: parseSignalList(signalValues.resourcesNeeded, 120),
          businessSummary: optionalValues.businessSummary.trim(),
          locationSummary: optionalValues.locationSummary.trim(),
        });

        void markAnonymousProfileIntroSeen();
        setWizardStep('circles');
        return;
      }

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

      // Hold the result and move to the newcomer-home step instead of
      // logging in immediately - login() sets profileOnboardingCompletedAt,
      // which AuthContext watches to redirect out of /profile-onboarding
      // (contexts/auth-context.tsx). Calling it now would blow past this
      // step the instant it renders.
      setProfileResult(result);
      setWizardStep('circles');
    } catch (err) {
      console.error('Profile onboarding save failed:', err);
      setError(err instanceof Error ? err.message : 'Could not save your profile. Try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color="#FF6B00" size="large" />
      </SafeAreaView>
    );
  }

  if (wizardStep === 'intro') {
    return (
      <SafeAreaView style={introStyles.screen}>
        <ScrollView style={introStyles.scroll} contentContainerStyle={introStyles.content}>
          <View style={introStyles.header}>
            <View style={introStyles.badge}>
              <UserCircle color="#FF6B00" size={18} strokeWidth={2.4} />
              <Text style={introStyles.badgeText}>Welcome to Cahootz</Text>
            </View>
            <Text style={introStyles.title}>A community app for everyday help and action</Text>
            <Text style={introStyles.subtitle}>
              Cahootz is a place to meet people, share what you need, offer what you can, and start real conversations.
            </Text>
          </View>

          <View style={introStyles.appIntro}>
            <ScrollView
              ref={introCarouselRef}
              horizontal
              pagingEnabled
              snapToInterval={introCardWidth}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={updateIntroCarouselIndex}
              style={introStyles.carousel}
            >
              {appIntroItems.map(({ title, body, visual, visualBg, Icon }) => (
                <View key={title} style={[introStyles.carouselCard, { width: introCardWidth }]}>
                  <View style={[introStyles.carouselVisual, { backgroundColor: visualBg }]}>
                    <Text style={introStyles.carouselEmoji}>{visual}</Text>
                    <View style={introStyles.carouselIcon}>
                      <Icon color="#FF6B00" size={20} strokeWidth={2.5} />
                    </View>
                  </View>
                  <Text style={introStyles.carouselTitle}>{title}</Text>
                  <Text style={introStyles.carouselBody}>{body}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={introStyles.carouselDots}>
              {appIntroItems.map((item, index) => {
                const active = introCarouselIndex === index;

                return (
                  <Pressable
                    key={item.title}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${item.title}`}
                    onPress={() => goToIntroSlide(index)}
                    style={[introStyles.carouselDot, active && introStyles.carouselDotActive]}
                  />
                );
              })}
            </View>
          </View>
        </ScrollView>

        <View style={introStyles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setWizardStep('profile')}
            style={introStyles.submitButton}
          >
            <Text style={introStyles.submitText}>Continue</Text>
            <ArrowRight color="#FFFFFF" size={20} strokeWidth={2.6} />
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (wizardStep === 'circles') {
    return (
      <SafeAreaView style={circlesStyles.screen}>
        <ScrollView contentContainerStyle={circlesStyles.content}>
          <Text style={circlesStyles.eyebrow}>Almost there</Text>
          <Text style={circlesStyles.title}>Find your way in</Text>
          <Text style={circlesStyles.subtitle}>
            Meet people, visit a commons, or look around first.
          </Text>

          {error ? <Text style={circlesStyles.error}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={isJoiningWelcomeTable}
            onPress={handleJoinWelcomeTable}
            style={[circlesStyles.card, isJoiningWelcomeTable && circlesStyles.cardDisabled]}
          >
            <View style={[circlesStyles.cardIcon, { backgroundColor: '#FFF7ED' }]}>
              <MessageCircle color="#FF6B00" size={22} strokeWidth={2.4} />
            </View>
            <View style={circlesStyles.cardBody}>
              <Text style={circlesStyles.cardTitle}>Join a welcome lounge</Text>
              <Text style={circlesStyles.cardText}>
                Meet a small group of newcomers with a guide.
              </Text>
            </View>
            {isJoiningWelcomeTable ? (
              <ActivityIndicator color="#FF6B00" />
            ) : (
              <ArrowRight color="#FF6B00" size={20} strokeWidth={2.6} />
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={handleExploreOnMyOwn}
            style={circlesStyles.card}
          >
            <View style={[circlesStyles.cardIcon, { backgroundColor: '#EFF6FF' }]}>
              <Compass color="#1D4ED8" size={22} strokeWidth={2.4} />
            </View>
            <View style={circlesStyles.cardBody}>
              <Text style={circlesStyles.cardTitle}>Explore on my own</Text>
              <Text style={circlesStyles.cardText}>
                Browse public commons and circles.
              </Text>
            </View>
            <ArrowRight color="#1D4ED8" size={20} strokeWidth={2.6} />
          </Pressable>

          <View style={[circlesStyles.card, circlesStyles.cardDisabled]}>
            <View style={[circlesStyles.cardIcon, { backgroundColor: '#F0FDF4' }]}>
              <Users color="#15803D" size={22} strokeWidth={2.4} />
            </View>
            <View style={circlesStyles.cardBody}>
              <Text style={circlesStyles.cardTitle}>Meet someone</Text>
              <Text style={circlesStyles.cardText}>Coming soon.</Text>
            </View>
          </View>
        </ScrollView>

        <View style={introStyles.footer}>
          <Pressable accessibilityRole="button" onPress={handleSkipCircles} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Skip for now</Text>
          </Pressable>
        </View>
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
            style={[styles.submitButton, (!canSubmit || isSaving) && styles.submitButtonDisabled]}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const introStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F2F5',
    backgroundColor: '#FFFFFF',
  },
  header: {
    paddingTop: 8,
    paddingBottom: 18,
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
    marginBottom: 20,
  },
  carousel: {
    overflow: 'visible',
  },
  carouselCard: {
    minHeight: 300,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#F0F2F5',
    backgroundColor: '#FFFFFF',
    padding: 18,
    justifyContent: 'center',
  },
  carouselVisual: {
    height: 132,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    position: 'relative',
  },
  carouselEmoji: {
    fontSize: 60,
    lineHeight: 72,
  },
  carouselIcon: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  carouselTitle: {
    color: '#0F172A',
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '900',
  },
  carouselBody: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  carouselDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  carouselDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#CBD5E1',
  },
  carouselDotActive: {
    width: 22,
    backgroundColor: '#FF6B00',
  },
  submitButton: {
    minHeight: 58,
    borderRadius: 16,
    backgroundColor: '#FF6B00',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
});

const circlesStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    gap: 12,
  },
  eyebrow: {
    color: '#FF6B00',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  title: {
    color: '#0F172A',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    marginTop: 6,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4,
    marginBottom: 8,
  },
  error: {
    color: '#DC2626',
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F0F2F5',
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  cardDisabled: {
    opacity: 0.55,
  },
  cardIcon: {
    height: 48,
    width: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    color: '#0F172A',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  cardText: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
});

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
