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
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowRight, HandHeart, Lightbulb, MessageCircle, UserCircle, Users } from 'lucide-react-native';

import { CommonsInvitationsCard } from '@/components/commons-invitations-card';
import { InviteContactsCard } from '@/components/invite-contacts-card';
import { OnboardingFamilyChoices, isFamilyInvitation } from '@/components/onboarding-family-choices';

import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';
import {
  getOrCreateAnonymousId,
  hasSeenAnonymousProfileIntro,
  markAnonymousProfileIntroSeen,
} from '@/lib/anonymous-id';
import { track } from '@/lib/analytics';
import { friendlyError } from '@/lib/friendly-error';
import { secureStorage } from '@/lib/secure-storage';
import { keyboardScrollProps } from '@/lib/keyboard';

const MIN_SELF_DESCRIPTION = 40;
const MIN_SIGNAL_ITEMS = 1;
type WizardStep = 'profile' | 'invite' | 'circles';
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
    helper: 'What do you want to hear about or connect around? Separate each one with a comma.',
    placeholder: 'music, housing, food, wellness, events',
    minItems: MIN_SIGNAL_ITEMS,
    maxItemLength: 80,
  },
  {
    name: 'resourcesOffered',
    label: 'What you can offer',
    helper: 'This can be skills, time, tools, space, rides, advice, or encouragement. Separate each one with a comma.',
    placeholder: 'childcare, rides, cooking, design help',
    minItems: MIN_SIGNAL_ITEMS,
    maxItemLength: 120,
  },
  {
    name: 'resourcesNeeded',
    label: "What you're looking for",
    helper: 'Share what would help you, your family, or something you are working on. Separate each one with a comma.',
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

// Email-verified newcomers start with questions until they finish onboarding.
export default function ProfileOnboardingScreen() {
  const { user, sessionToken, isLoading, login, deferProfileOnboarding } = useAuth();
  const { chooseCommons } = useLocalSearchParams<{ chooseCommons?: string }>();
  const [wizardStep, setWizardStep] = useState<WizardStep>('profile');
  const [firstStepChosen, setFirstStepChosen] = useState(false);
  const firstStepCheckStarted = useRef(false);
  const [hasCommonsMembership, setHasCommonsMembership] = useState<boolean | null>(null);

  useEffect(() => {
    setHasCommonsMembership(null);
    if (!sessionToken) { setHasCommonsMembership(false); return; }
    let cancelled = false;
    void api.listCommonsDirectory(sessionToken).then(({ coops }) => {
      if (!cancelled) setHasCommonsMembership(coops.some((commons) => commons.isMember));
    }).catch(() => { if (!cancelled) setHasCommonsMembership(false); });
    return () => { cancelled = true; };
  }, [sessionToken]);


  useEffect(() => {
    if (isLoading || firstStepCheckStarted.current) return;
    firstStepCheckStarted.current = true;

    if (!user || !sessionToken) {
      router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
      return;
    }

    setWizardStep(chooseCommons === '1' && user.onboardingCompletedAt ? 'circles' : 'profile');
    setFirstStepChosen(true);
  }, [isLoading, user, sessionToken, chooseCommons]);

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

  const progressQueue = useRef<Promise<unknown>>(Promise.resolve());
  const profileHydrated = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading || !user || profileHydrated.current === user.id) return;
    profileHydrated.current = user.id;
    setSelfDescription(user.selfDescription ?? '');
    setSignalValues({
      interests: user.interests?.join(', ') ?? '',
      resourcesOffered: user.resourcesOffered?.join(', ') ?? '',
      resourcesNeeded: user.resourcesNeeded?.join(', ') ?? '',
    });
    setOptionalValues({
      goals: user.shortTermGoals ?? '',
      businessSummary: user.businessSummary ?? '',
      locationSummary: user.locationSummary ?? '',
    });
  }, [isLoading, user]);

  const saveProgress = (next: 'profile' | 'invite' | 'commons' | 'complete') => {
    if (!sessionToken) return Promise.resolve(null);
    const request = progressQueue.current.catch(() => {}).then(() => api.saveOnboardingProgress(next, sessionToken));
    progressQueue.current = request;
    return request;
  };

  const introComplete = selfDescription.trim().length >= introField.minChars;
  const signedIn = !!user && !!sessionToken;

  useEffect(() => {
    if (isLoading) return;
    track('onboarding_step_viewed', { step: wizardStep, signed_in: signedIn });
    // Once per step; signedIn doesn't change while the wizard is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardStep, isLoading]);

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

  // Plain list of what still needs filling in, so "Start using Cahootz"
  // can say why it can't continue yet instead of sitting greyed out.
  const missingParts = useMemo(() => {
    const parts: string[] = [];
    const charsLeft = introField.minChars - selfDescription.trim().length;
    if (charsLeft > 0) {
      parts.push(`Write ${charsLeft} more ${charsLeft === 1 ? 'letter' : 'letters'} in "${introField.label}"`);
    }
    signalFields.forEach((field) => {
      if (!signalProgress[field.name].complete) parts.push(`Add at least one thing to "${field.label}"`);
    });
    return parts;
  }, [selfDescription, signalProgress]);

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

  const handleSignInInstead = async () => {
    track('onboarding_sign_in_chosen', { step: wizardStep });
    // Remember the intro was seen first, or "/" sends them straight back here.
    await markAnonymousProfileIntroSeen().catch(() => {});
    router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
  };

  // Leaving the profile form: drop its "Almost there" error so it doesn't
  // follow the newcomer onto the next step.
  const goToInviteStep = async () => {
    const progress = await saveProgress('invite');
    if (progress && user && sessionToken) await login({ ...user, ...progress, sessionToken });
    setError('');
    setWizardStep('invite');
  };

  const handleSkip = async () => {
    if (isSaving) return;

    track('onboarding_deferred', { step: 'profile', signed_in: signedIn });

    if (!user) {
      // Anonymous visitors still see the newcomer-home step - only the
      // account-only actions on it (starting a family) require signing
      // in, same as any other authenticated action in the app.
      void markAnonymousProfileIntroSeen();
      await goToInviteStep();
      return;
    }

    try {
      await deferProfileOnboarding();
      // Skipping the profile form only skips the form - still show the
      // final commons choice so people can choose where they belong.
      await goToInviteStep();
    } catch (err) {
      console.error('Profile onboarding skip failed:', err);
      setError('Could not skip right now. Try again.');
    }
  };

  // Save the completed profile in the session before opening the chosen
  // destination. The wizard, rather than the auth guard, owns this exit.
  const completeOnboarding = async (
    destination: { pathname: string; params?: Record<string, string> },
    exit: 'commons' | 'invitation' | 'family',
  ) => {

    if (!user || !sessionToken) {
      track('onboarding_completed', { exit, profile_completed: !!profileResult, signed_in: false });
      void markAnonymousProfileIntroSeen();
      if (exit === 'family') {
        await secureStorage.setItem(secureStorage.keys.COMMONS_DESTINATION, 'family');
        router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
      } else {
        router.replace(destination as any);
      }
      return;
    }

    try {
      const progress = await saveProgress('complete');
      await login({
        ...user,
        ...(profileResult?.user || {}),
        ...progress,
        createdAt: profileResult ? new Date(profileResult.user.createdAt) : user.createdAt,
        profileOnboardingCompletedAt: profileResult?.user.profileOnboardingCompletedAt
          ? new Date(profileResult.user.profileOnboardingCompletedAt) : user.profileOnboardingCompletedAt,
        sessionToken,
        coop: user.coop,
      });
    } catch {
      setError("We couldn’t save your progress. Please try again.");
      return;
    }

    track('onboarding_completed', { exit, profile_completed: !!profileResult, signed_in: true });
    router.replace(destination as any);
  };

  useEffect(() => {
    if (wizardStep !== 'circles' || !user || !sessionToken) return;
    let cancelled = false;
    void secureStorage.getItem(secureStorage.keys.COMMONS_DESTINATION).then(async (destination) => {
      if (cancelled || !destination) return;
      if (destination !== 'family' && !destination.startsWith('commons:')) return;
      await secureStorage.removeItem(secureStorage.keys.COMMONS_DESTINATION);
      await completeOnboarding({ pathname: destination === 'family' ? '/(authenticated)/create-family' : `/commons/${destination.slice(8)}` }, destination === 'family' ? 'family' : 'commons');
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardStep, user, sessionToken]);

  // A commons invitation link opened while signed out (see
  // components/commons-invitation-view.tsx) resumes here, once the new
  // account has been through the wizard. Cleared first so it fires once.
  useEffect(() => {
    if (wizardStep !== 'circles' || !user || !sessionToken) return;

    let cancelled = false;
    secureStorage.getItem(secureStorage.keys.PENDING_INVITATION).then(async (token) => {
      if (!token || cancelled) return;
      void secureStorage.removeItem(secureStorage.keys.PENDING_INVITATION);
      void completeOnboarding({ pathname: '/invite/[token]', params: { token } }, 'invitation');
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardStep, user, sessionToken]);

  const continueAfterInvites = async () => {
    try {
      const progress = await saveProgress('commons');
      if (progress && user && sessionToken) await login({ ...user, ...progress, sessionToken });
      setWizardStep('circles');
    } catch { setError("We couldn’t save your progress. Please try again."); }
  };

  const handleOpenInvitation = async (invitationId: string) => {
    void completeOnboarding(
      { pathname: '/invitations/[invitationId]', params: { invitationId } },
      'invitation',
    );
  };

  // A family they already belong to (say, joined from a link before
  // finishing onboarding): straight to its feed, not the Cahootz Commons.
  const handleGoToFamily = async (coopId: string) => {
    void completeOnboarding({ pathname: '/[coopId]/posts', params: { coopId } }, 'family');
  };

  const handleSubmit = async () => {
    if (isSaving) return;

    if (missingParts.length > 0) {
      setError(
        `Almost there. To continue:\n• ${missingParts.join('\n• ')}\n\nOr tap "Do this later" to skip for now.`,
      );
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
        await goToInviteStep();
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

      // Keep the current wizard open through invitations and commons choice.
      setProfileResult(result);
      await goToInviteStep();
    } catch (err) {
      console.error('Profile onboarding save failed:', err);
      setError(friendlyError(err, "We couldn't save your profile."));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !firstStepChosen || !user || !sessionToken) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color="#FF6B00" size="large" />
      </SafeAreaView>
    );
  }

  if (wizardStep === 'invite') {
    return (
      <SafeAreaView style={circlesStyles.screen}>
        <ScrollView contentContainerStyle={circlesStyles.content}>
          <Text style={circlesStyles.eyebrow}>Bring people with you</Text>
          <Text style={circlesStyles.title}>Invite people you know</Text>
          <Text style={circlesStyles.subtitle}>
            Cahootz works best with the people you already count on. Invite a friend or relative to
            join you. You can always do this later.
          </Text>
          {error ? <Text style={circlesStyles.error}>{error}</Text> : null}
          <InviteContactsCard source="onboarding" />
        </ScrollView>

        <View style={introStyles.footer}>
          {error ? <Text accessibilityRole="alert">{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => void continueAfterInvites()}
            style={introStyles.submitButton}
          >
            <Text style={introStyles.submitText}>Next</Text>
            <ArrowRight color="#FFFFFF" size={20} strokeWidth={2.6} />
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (wizardStep === 'circles' && hasCommonsMembership === null) {
    return <SafeAreaView style={circlesStyles.screen}><ActivityIndicator accessibilityLabel="Loading your commons" color="#FF6B00" /></SafeAreaView>;
  }

  if (wizardStep === 'circles') {
    return (
      <SafeAreaView style={circlesStyles.screen}>
        <ScrollView contentContainerStyle={circlesStyles.content}>
          <Text style={circlesStyles.eyebrow}>Almost there</Text>
          <Text style={circlesStyles.title}>{hasCommonsMembership ? "You’re already in" : "Find your people"}</Text>
          <Text style={circlesStyles.subtitle}>
            {hasCommonsMembership ? "Your people are here. Open a commons to get started." : "Choose a commons to join, or start a private space for your family."}
          </Text>

          {error ? <Text style={circlesStyles.error}>{error}</Text> : null}

          {user && sessionToken ? (
            <>
              {hasCommonsMembership ? <OnboardingFamilyChoices
                onGoToFamily={(coopId) => void handleGoToFamily(coopId)}
                onOpenInvitation={(invitationId) => void handleOpenInvitation(invitationId)}
              /> : null}
              <View style={{ marginBottom: 12 }}>
                <CommonsInvitationsCard
                  exclude={hasCommonsMembership ? isFamilyInvitation : undefined}
                  onOpen={(invitation) => void handleOpenInvitation(invitation.invitationId!)}
                />
              </View>
            </>
          ) : null}

          {!hasCommonsMembership ? <>
          <Pressable accessibilityRole="button" accessibilityLabel="Explore commons"
            onPress={() => void completeOnboarding({ pathname: '/commons', params: { fromOnboarding: '1' } }, 'commons')}
            style={[choiceStyles.card, { backgroundColor: '#E8F4E5' }]}>
            <Text style={choiceStyles.title}>{'Meet. Share.\nBelong.'}</Text>
            <Text style={choiceStyles.body}>Find a public commons around the things you care about.</Text>
            <View style={choiceStyles.action}><Text style={choiceStyles.actionText}>Explore commons</Text><ArrowRight color="#C2410C" size={24} /></View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Start a family"
            onPress={() => void completeOnboarding({ pathname: '/(authenticated)/create-family', params: { fromOnboarding: '1' } }, 'family')}
            style={[choiceStyles.card, { backgroundColor: '#F0E9FB' }]}>
            <Text style={choiceStyles.title}>{'Your people.\nYour own space.'}</Text>
            <Text style={choiceStyles.body}>Start a private, invite-only commons for your family.</Text>
            <View style={choiceStyles.action}><Text style={choiceStyles.actionText}>Start a family</Text><ArrowRight color="#C2410C" size={24} /></View>
          </Pressable>
          </> : null}
          {hasCommonsMembership ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Skip for now"
              onPress={() => void completeOnboarding({ pathname: '/(tabs)' }, 'commons')}
              style={styles.secondaryButton}>
              <Text style={choiceStyles.actionText}>Skip for now</Text>
            </Pressable>
          ) : null}
          {!hasCommonsMembership ? <Text style={choiceStyles.footer}>{'Choose where you belong.\nYou can join more than one commons.'}</Text> : null}
        </ScrollView>
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
          {...keyboardScrollProps}
          ref={scrollRef}
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
                <Text style={styles.label}>
                  {introField.label} <Text style={styles.requiredTag}>(required)</Text>
                </Text>
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
                      <Text style={styles.label}>
                        {field.label} <Text style={styles.requiredTag}>(required)</Text>
                      </Text>
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

          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityHint={canSubmit ? undefined : 'Shows what still needs filling in'}
            disabled={isSaving}
            onPress={handleSubmit}
            style={[styles.submitButton, isSaving && styles.submitButtonDisabled]}
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

const choiceStyles = StyleSheet.create({
  card: { borderRadius: 24, padding: 24, minHeight: 240, marginTop: 8 },
  title: { color: '#0F172A', fontSize: 28, lineHeight: 34, fontWeight: '900' },
  body: { color: '#475569', fontSize: 16, lineHeight: 24, marginTop: 14 },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 32 },
  actionText: { color: '#C2410C', fontSize: 16, fontWeight: '800' },
  footer: { color: '#64748B', fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 32, marginBottom: 16 },
});

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
  requiredTag: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '600',
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
