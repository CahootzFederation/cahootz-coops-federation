import { useEffect, useMemo, useState } from 'react';
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
import { ArrowRight, Sparkles } from 'lucide-react-native';

import { useAuth } from '@/contexts/auth-context';
import { api } from '@/lib/api';

const MIN_SELF_DESCRIPTION = 120;
const MIN_GOALS = 50;

type FieldName = 'selfDescription' | 'shortTermGoals' | 'longTermGoals';
type ListFieldName = 'skills' | 'interests' | 'resourcesOffered' | 'resourcesNeeded';
type OptionalFieldName = 'businessSummary' | 'locationSummary';

type FieldConfig = {
  name: FieldName;
  label: string;
  helper: string;
  placeholder: string;
  minChars: number;
  minHeight: number;
};

const fields: FieldConfig[] = [
  {
    name: 'selfDescription',
    label: 'Describe yourself',
    helper: 'Give a real paragraph or two: background, skills, interests, what you care about, what you can offer, and what you need.',
    placeholder: 'I am a designer and neighborhood organizer in Oakland. I care about...',
    minChars: MIN_SELF_DESCRIPTION,
    minHeight: 180,
  },
  {
    name: 'shortTermGoals',
    label: 'Short-term life goals',
    helper: 'What are you trying to move forward over the next few months?',
    placeholder: 'This season I want to...',
    minChars: MIN_GOALS,
    minHeight: 132,
  },
  {
    name: 'longTermGoals',
    label: 'Long-term life goals',
    helper: 'What kind of future are you building toward over the next few years?',
    placeholder: 'Long term, I want to build...',
    minChars: MIN_GOALS,
    minHeight: 132,
  },
];

const signalFields: {
  name: ListFieldName;
  label: string;
  helper: string;
  placeholder: string;
}[] = [
  {
    name: 'skills',
    label: 'Skills',
    helper: 'Separate with commas or new lines.',
    placeholder: 'design, childcare, grant writing, event planning',
  },
  {
    name: 'interests',
    label: 'Interests',
    helper: 'Topics, scenes, causes, or culture you care about.',
    placeholder: 'music, housing, wellness, mutual aid, local business',
  },
  {
    name: 'resourcesOffered',
    label: 'What you can offer',
    helper: 'People, space, tools, capital, experience, services.',
    placeholder: 'studio space, bookkeeping help, vendor contacts',
  },
  {
    name: 'resourcesNeeded',
    label: 'What you need',
    helper: 'Things that would help you or your work move faster.',
    placeholder: 'venue access, marketing help, startup capital',
  },
];

function parseSignalList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).slice(0, 30);
}

export default function ProfileOnboardingScreen() {
  const { user, sessionToken, isLoading, login } = useAuth();
  const [values, setValues] = useState<Record<FieldName, string>>({
    selfDescription: user?.selfDescription || '',
    shortTermGoals: user?.shortTermGoals || '',
    longTermGoals: user?.longTermGoals || '',
  });
  const [signalValues, setSignalValues] = useState<Record<ListFieldName, string>>({
    skills: user?.skills?.join(', ') || '',
    interests: user?.interests?.join(', ') || '',
    resourcesOffered: user?.resourcesOffered?.join(', ') || '',
    resourcesNeeded: user?.resourcesNeeded?.join(', ') || '',
  });
  const [optionalValues, setOptionalValues] = useState<Record<OptionalFieldName, string>>({
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

  const fieldProgress = useMemo(() => {
    return fields.reduce<Record<FieldName, boolean>>((acc, field) => {
      acc[field.name] = values[field.name].trim().length >= field.minChars;
      return acc;
    }, {} as Record<FieldName, boolean>);
  }, [values]);

  const canSubmit = fields.every((field) => fieldProgress[field.name]) && !!sessionToken && !!user;

  const updateField = (name: FieldName, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
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

  const handleSubmit = async () => {
    if (!user || !sessionToken || isSaving) return;

    const missingField = fields.find((field) => !fieldProgress[field.name]);
    if (missingField) {
      setError(`${missingField.label} needs a little more detail before you continue.`);
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const result = await api.completeProfileOnboarding(
        {
          selfDescription: values.selfDescription.trim(),
          shortTermGoals: values.shortTermGoals.trim(),
          longTermGoals: values.longTermGoals.trim(),
          skills: parseSignalList(signalValues.skills),
          interests: parseSignalList(signalValues.interests),
          resourcesOffered: parseSignalList(signalValues.resourcesOffered),
          resourcesNeeded: parseSignalList(signalValues.resourcesNeeded),
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

      router.replace('/(tabs)' as any);
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
        <ActivityIndicator color="#F97316" size="large" />
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
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <View style={styles.header}>
            <View style={styles.badge}>
              <Sparkles color="#F97316" size={18} strokeWidth={2.4} />
              <Text style={styles.badgeText}>First profile signal</Text>
            </View>
            <Text style={styles.title}>Tell Cahootz who you are.</Text>
            <Text style={styles.subtitle}>
              Cahootz helps communities organize people, skills, businesses, resources, and capital into coordinated action. Give the system enough signal to understand where you fit.
            </Text>
          </View>

          <View style={styles.form}>
            {fields.map((field) => {
              const count = values[field.name].trim().length;
              const complete = fieldProgress[field.name];
              const remaining = Math.max(field.minChars - count, 0);

              return (
                <View key={field.name} style={styles.fieldBlock}>
                  <View style={styles.fieldHeader}>
                    <Text style={styles.label}>{field.label}</Text>
                    <Text style={[styles.counter, complete && styles.counterComplete]}>
                      {complete ? 'Good detail' : `${remaining} more`}
                    </Text>
                  </View>
                  <Text style={styles.helper}>{field.helper}</Text>
                  <TextInput
                    value={values[field.name]}
                    onChangeText={(value) => updateField(field.name, value)}
                    placeholder={field.placeholder}
                    placeholderTextColor="#9CA3AF"
                    multiline
                    textAlignVertical="top"
                    style={[styles.input, { minHeight: field.minHeight }]}
                  />
                </View>
              );
            })}

            <View style={styles.signalGrid}>
              {signalFields.map((field) => (
                <View key={field.name} style={styles.fieldBlock}>
                  <View style={styles.fieldHeader}>
                    <Text style={styles.label}>{field.label}</Text>
                    <Text style={styles.counter}>
                      {parseSignalList(signalValues[field.name]).length || 'Add a few'}
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
              ))}
            </View>

            <View style={styles.fieldBlock}>
              <Text style={styles.label}>Business or work</Text>
              <Text style={styles.helper}>
                Optional, but useful if you run something, sell something, or want the commons to understand your economic lane.
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
              <ActivityIndicator color="#111827" />
            ) : (
              <>
                <Text style={styles.submitText}>Start using Cahootz</Text>
                <ArrowRight color="#111827" size={20} strokeWidth={2.6} />
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#111827',
  },
  keyboardView: {
    flex: 1,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  header: {
    paddingTop: 8,
    paddingBottom: 22,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.32)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 18,
  },
  badgeText: {
    color: '#FED7AA',
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
    letterSpacing: 0,
  },
  subtitle: {
    color: '#D1D5DB',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
  },
  form: {
    gap: 18,
  },
  fieldBlock: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#1F2937',
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
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  counter: {
    color: '#FDBA74',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  counterComplete: {
    color: '#86EFAC',
  },
  helper: {
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 12,
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4B5563',
    backgroundColor: '#FFFFFF',
    color: '#111827',
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
    color: '#FCA5A5',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 16,
  },
  submitButton: {
    minHeight: 58,
    borderRadius: 8,
    backgroundColor: '#F97316',
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
    color: '#111827',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
});
