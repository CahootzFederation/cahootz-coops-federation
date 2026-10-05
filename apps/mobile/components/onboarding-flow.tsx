import React, { useState, useEffect, useMemo } from 'react';
import { ScrollView, View, Pressable, TextInput, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useSubmitApplication } from '@/hooks/use-api';
import { useAuth } from '@/contexts/auth-context';
import { friendlyError } from '@/lib/friendly-error';
import { getApiUrl } from '@/lib/config';
import { api } from '@/lib/api';
import { getAnonymousId, clearAnonymousId } from '@/lib/anonymous-id';
import { buildMobileApplicationSubmissionInput } from '@/lib/application-submission';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import VideoUpload from '@/components/video-upload';
import PhotoUpload from '@/components/photo-upload';
import {
  Heart,
  Users,
  TrendingUp,
  Store,
  Vote,
  Shield,
  Building,
  Award,
  ChevronLeft,
  ChevronRight,
  Camera,
  CheckCircle2,
  Mail,
} from 'lucide-react-native';

const DEMO_COOP_ID = 'demo';
const DEMO_LOGIN_EMAIL = 'demo@cahootz.coop';

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  agreeToTerms: boolean;
  agreeToPrivacy: boolean;
  agreeToCoopValues: boolean;
  // Media uploads
  videoCID: string;
  photoCID: string;
  // Dynamic question answers stored as key-value pairs
  dynamicAnswers: Record<string, any>;
}

interface ApplicationQuestion {
  id: string;
  type: string;
  label: string;
  description?: string;
  placeholder?: string;
  required: boolean;
  options?: { value: string; label: string }[];
  validation?: Record<string, unknown>;
}

type OnboardingFlowProps = {
  initialStep?: 'intro' | 'browse' | 'login';
  onBack?: () => void;
};

// Step numbers: 0 browse commons, 1 commons details, 2-5 application,
// 6 submitted, 7 sign in. (The old intro splash cards were removed; the
// welcome wizard in app/profile-onboarding.tsx introduces the app now.)
const BROWSE_STEP = 0;
const LOGIN_STEP = 7;

const getInitialStep = (initialStep: OnboardingFlowProps['initialStep']) => {
  if (initialStep === 'browse') return BROWSE_STEP;
  if (initialStep === 'login') return LOGIN_STEP;
  return 0;
};

export default function OnboardingFlow({ initialStep = 'intro', onBack }: OnboardingFlowProps = {}) {
  const [currentStep, setCurrentStep] = useState(getInitialStep(initialStep));
  const [selectedCoopId, setSelectedCoopId] = useState<string | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  // Saved on the application by the server (Application.referenceCode).
  const [applicationReference, setApplicationReference] = useState<string | null>(null);
  const [loginData, setLoginData] = useState({
    email: '',
    code: '',
  });
  const [codeSent, setCodeSent] = useState(false);
  const [canResend, setCanResend] = useState(true);
  const [resendTimer, setResendTimer] = useState(0);
  const [loginError, setLoginError] = useState<string>('');
  const [waitlistData, setWaitlistData] = useState({
    name: '',
    email: '',
    suggestedCoop: '',
  });
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [waitlistMessage, setWaitlistMessage] = useState('');

  // API hooks
  const { submitApplication, isLoading: isSubmitting, error: submitError, clearError: clearSubmitError } = useSubmitApplication();
  const [isRequestingCode, setIsRequestingCode] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const { login } = useAuth();
  const isDemoLoginEmail = loginData.email.trim().toLowerCase() === DEMO_LOGIN_EMAIL;

  // Fetch available coops from backend
  const [availableCoops, setAvailableCoops] = useState<{
    id: string;
    name: string;
    tagline: string;
    description: string;
    mission: string;
    features: { title: string; description: string }[];
    eligibility: string;
    bgColor: string;
    accentColor: string;
  }[]>([]);
  const [isLoadingCoops, setIsLoadingCoops] = useState(true);
  
  // Dynamic application questions
  const [applicationQuestions, setApplicationQuestions] = useState<ApplicationQuestion[]>([]);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);

  useEffect(() => {
    const fetchCoops = async () => {
      try {
        const coops = await api.listAvailableCoops();
        console.log('Fetched coops from backend:', coops);
        setAvailableCoops(coops);
      } catch (error) {
        console.error('Failed to load coops:', error);
        const fallbackCoops: any[] = [];
        console.log('Using fallback coops:', fallbackCoops);
        setAvailableCoops(fallbackCoops);
      } finally {
        setIsLoadingCoops(false);
      }
    };
    fetchCoops();
  }, []);

  // Fetch application questions when a coop is selected
  useEffect(() => {
    const fetchQuestions = async () => {
      if (!selectedCoopId) return;
      
      setIsLoadingQuestions(true);
      try {
        const result = await api.getApplicationQuestions(selectedCoopId);
        setApplicationQuestions(result.questions);
        console.log('Loaded questions for coop:', selectedCoopId, result.questions);
      } catch (error) {
        console.error('Failed to fetch application questions:', error);
        // Use empty questions array as fallback
        setApplicationQuestions([]);
      } finally {
        setIsLoadingQuestions(false);
      }
    };

    fetchQuestions();
  }, [selectedCoopId]);

  // Display errors if they exist
  if (submitError) {
    console.error('Submit error:', submitError);
  }
  const [formData, setFormData] = useState<FormData>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    agreeToTerms: false,
    agreeToPrivacy: false,
    agreeToCoopValues: false,
    videoCID: '',
    photoCID: '',
    dynamicAnswers: {},
  });


  // Add icons to features from backend data - memoized to prevent infinite re-renders
  const coopsWithIcons = useMemo(() => {
    return availableCoops?.map(coop => ({
      ...coop,
      features: coop.features.map((feature) => {
        // Map feature titles to appropriate icons
        let icon = Store; // default
        if (feature.title.includes('Coin') || feature.title.includes('Governance')) icon = Vote;
        if (feature.title.includes('AI') || feature.title.includes('Proposal')) icon = TrendingUp;
        if (feature.title.includes('Housing')) icon = Building;
        if (feature.title.includes('Employment') || feature.title.includes('Network')) icon = Users;
        if (feature.title.includes('Venue') || feature.title.includes('Ownership')) icon = Store;
        
        return { ...feature, icon };
      }),
    })) || [];
  }, [availableCoops]);

  // Debug logging - only on mount or when values change
  useEffect(() => {
    console.log('availableCoops:', availableCoops);
    console.log('coopsWithIcons:', coopsWithIcons);
    console.log('isLoadingCoops:', isLoadingCoops);
  }, [availableCoops, coopsWithIcons, isLoadingCoops]);

  const handleInputChange = (field: keyof FormData, value: string | boolean | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrorMessage('');
  };

  const handleDynamicAnswerChange = (questionId: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      dynamicAnswers: {
        ...prev.dynamicAnswers,
        [questionId]: value,
      },
    }));
    setErrorMessage('');
  };

  const handleWaitlistSignup = async () => {
    if (waitlistStatus === 'submitting') return;

    const email = waitlistData.email.trim();
    if (!email.includes('@')) {
      setWaitlistStatus('error');
      setWaitlistMessage('Enter a valid email to join the waitlist.');
      return;
    }

    setWaitlistStatus('submitting');
    setWaitlistMessage('');

    try {
      const result = await api.submitWaitlist({
        email,
        name: waitlistData.name.trim() || undefined,
        suggestedCoop: waitlistData.suggestedCoop.trim() || undefined,
      });
      setWaitlistStatus('success');
      setWaitlistMessage(result.message || "You're on the list. We'll be in touch soon.");
    } catch (error) {
      console.error('Waitlist signup error:', error);
      setWaitlistStatus('error');
      setWaitlistMessage(friendlyError(error, "We couldn't add you to the waitlist."));
    }
  };

  const renderDynamicQuestion = (question: ApplicationQuestion) => {
    const answer = formData.dynamicAnswers[question.id];

    switch (question.type) {
      case 'radio':
        return (
          <View key={question.id}>
            <Label className="text-foreground font-medium mb-3">
              {question.label} {question.required && '*'}
            </Label>
            {question.description && (
              <Text className="text-sm text-muted-foreground mb-2">{question.description}</Text>
            )}
            <View className={question.options && question.options.length > 2 ? "gap-2" : "flex flex-row gap-4"}>
              {question.options?.map((option) => (
                <Button
                  key={option.value}
                  variant={answer === option.value ? 'default' : 'outline'}
                  onPress={() => handleDynamicAnswerChange(question.id, option.value)}
                  className={question.options && question.options.length > 2 ? "justify-start" : "flex-1"}
                >
                  <Text className={answer === option.value ? 'text-white' : 'text-foreground'}>
                    {option.label}
                  </Text>
                </Button>
              ))}
            </View>
          </View>
        );

      case 'select':
        return (
          <View key={question.id}>
            <Label className="text-foreground font-medium mb-3">
              {question.label} {question.required && '*'}
            </Label>
            {question.description && (
              <Text className="text-sm text-muted-foreground mb-2">{question.description}</Text>
            )}
            <View className="gap-2">
              {question.options?.map((option) => (
                <Button
                  key={option.value}
                  variant={answer === option.value ? 'default' : 'outline'}
                  onPress={() => handleDynamicAnswerChange(question.id, option.value)}
                  className="justify-start"
                >
                  <Text className={answer === option.value ? 'text-white' : 'text-foreground'}>
                    {option.label}
                  </Text>
                </Button>
              ))}
            </View>
          </View>
        );

      case 'multiselect':
        const selectedValues = (answer as string[]) || [];
        return (
          <View key={question.id}>
            <Label className="text-foreground font-medium mb-3">
              {question.label} {question.required && '*'}
            </Label>
            {question.description && (
              <Text className="text-sm text-muted-foreground mb-2">{question.description}</Text>
            )}
            <View className="gap-2">
              {question.options?.map((option) => (
                <View key={option.value} className="flex flex-row items-center gap-2">
                  <Checkbox
                    checked={selectedValues.includes(option.value)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        handleDynamicAnswerChange(question.id, [...selectedValues, option.value]);
                      } else {
                        handleDynamicAnswerChange(
                          question.id,
                          selectedValues.filter((v) => v !== option.value)
                        );
                      }
                    }}
                  />
                  <Text className="text-sm text-foreground flex-1">{option.label}</Text>
                </View>
              ))}
            </View>
          </View>
        );

      case 'textarea':
        return (
          <View key={question.id}>
            <Label className="text-foreground font-medium">
              {question.label} {question.required && '*'}
            </Label>
            {question.description && (
              <Text className="text-sm text-muted-foreground mt-1">{question.description}</Text>
            )}
            <TextInput
              value={answer || ''}
              onChangeText={(text) => handleDynamicAnswerChange(question.id, text)}
              placeholder={question.placeholder || ''}
              multiline
              numberOfLines={3}
              className="mt-2 w-full px-3 py-2 border border-input rounded-md text-base text-foreground"
              style={{ textAlignVertical: 'top' }}
            />
          </View>
        );

      case 'text':
      case 'email':
      case 'phone':
      default:
        return (
          <View key={question.id}>
            <Label className="text-foreground font-medium">
              {question.label} {question.required && '*'}
            </Label>
            {question.description && (
              <Text className="text-sm text-muted-foreground mt-1">{question.description}</Text>
            )}
            <TextInput
              value={answer || ''}
              onChangeText={(text) => handleDynamicAnswerChange(question.id, text)}
              placeholder={question.placeholder || ''}
              keyboardType={question.type === 'email' ? 'email-address' : question.type === 'phone' ? 'phone-pad' : 'default'}
              className="mt-2 w-full px-3 py-2 border border-input rounded-md text-base text-foreground"
            />
          </View>
        );
    }
  };

  const nextStep = () => {
    setErrorMessage('');
    setCurrentStep(currentStep + 1);
  };

  const unansweredRequiredQuestions = applicationQuestions.filter((q) => {
    if (!q.required) return false;
    const answer = formData.dynamicAnswers[q.id];
    if (q.type === 'multiselect') {
      return !answer || (answer as string[]).length === 0;
    }
    return !answer || answer === '';
  });

  // Continue buttons stay tappable and say what's missing, instead of
  // sitting greyed out with no reason.
  const continuePastPersonalInfo = () => {
    const missing: string[] = [];
    if (!formData.firstName.trim()) missing.push('First Name');
    if (!formData.lastName.trim()) missing.push('Last Name');
    if (!formData.email.trim()) missing.push('Email');
    if (missing.length > 0) {
      setErrorMessage(`Please fill in these to continue:\n• ${missing.join('\n• ')}`);
      return;
    }
    nextStep();
  };

  const continuePastQuestions = () => {
    if (unansweredRequiredQuestions.length > 0) {
      setErrorMessage(
        `Please answer these questions to continue:\n• ${unansweredRequiredQuestions.map((q) => q.label).join('\n• ')}`,
      );
      return;
    }
    nextStep();
  };

  const prevStep = () => {
    setErrorMessage('');
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const goToLogin = () => {
    setErrorMessage('');
    setCurrentStep(LOGIN_STEP);
  };

  const goToBrowseCoops = () => {
    setCurrentStep(BROWSE_STEP);
  };

  const selectCoop = (coopId: string) => {
    setSelectedCoopId(coopId);
    nextStep(); // Go to coop details
  };

  const startApplication = () => {
    nextStep(); // Go to personal info form
  };

  const handleSubmitApplication = async () => {
    if (isSubmitting) return;
    
    // Clear any previous errors
    clearSubmitError();
    
    try {
      // Detailed validation with specific error messages
      const missingFields: string[] = [];
      
      if (!formData.firstName) missingFields.push('First Name');
      if (!formData.lastName) missingFields.push('Last Name');
      if (!formData.email) missingFields.push('Email');
      if (!formData.phone) missingFields.push('Phone Number');
      
      // Validate dynamic questions
      applicationQuestions.forEach((question) => {
        if (question.required) {
          const answer = formData.dynamicAnswers[question.id];
          if (!answer || (question.type === 'multiselect' && (answer as string[]).length === 0)) {
            missingFields.push(question.label);
          }
        }
      });
      
      if (!formData.agreeToCoopValues) missingFields.push("Check the box for this commons' values and mission");
      if (!formData.agreeToTerms) missingFields.push('Check the box for the Terms of Service');
      if (!formData.agreeToPrivacy) missingFields.push('Check the box for the Privacy Policy');
      
      if (missingFields.length > 0) {
        setErrorMessage(`Please finish these before you submit:\n• ${missingFields.join('\n• ')}`);
        setSubmissionStatus('idle');
        return;
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email)) {
        setErrorMessage('Please enter a valid email address.');
        setSubmissionStatus('idle');
        return;
      }

      // Prepare application data with dynamic answers
      const applicationData = buildMobileApplicationSubmissionInput(selectedCoopId!, formData);

      // Submit application using hook
      console.log('📤 Submitting application for coop:', applicationData.coopId);
      
      setSubmissionStatus('submitting');
      

      
      try {
      const result = await submitApplication(applicationData);
        console.log('✅ Application submitted successfully:', result);
      
      if (result.success) {
          setApplicationReference(result.referenceCode ?? null);
          setSubmissionStatus('success');
          // Success! Move to success screen
          setTimeout(() => {
        setCurrentStep(currentStep + 1);
            setSubmissionStatus('idle');
          }, 1000); // Show success state for 1 second before transitioning
      } else {
          setSubmissionStatus('idle');
          setErrorMessage(result.message || 'Submission failed. Please try again.');
          console.error('❌ Submission failed:', result);
        }
      } catch (submitError) {
        console.error('❌ Application submission error:', submitError);
        
        setSubmissionStatus('idle');
        setErrorMessage(friendlyError(submitError, "We couldn't send your application."));
      }
    } catch (error) {
      console.error('💥 Outer catch - Application submission error:', error);
      setSubmissionStatus('idle');
      setErrorMessage(friendlyError(error, "We couldn't send your application."));
    }
  };

  // Resend timer effect
  React.useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => {
        setResendTimer(resendTimer - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setCanResend(true);
    }
  }, [resendTimer]);

  const handleRequestCode = async () => {
    if (isRequestingCode || !loginData.email) return;

    setIsRequestingCode(true);
    setLoginError('');

    try {
      const result = await api.requestLoginCode(
        loginData.email,
        isDemoLoginEmail ? DEMO_COOP_ID : undefined
      );

      setCodeSent(true);
      setCanResend(false);
      setResendTimer(60); // 60 second cooldown
      Alert.alert('Code Sent', result.message || 'Check your email for the login code');
    } catch (error) {
      console.error('Request code error:', error);
      setLoginError(friendlyError(error, "We couldn't send your code. Check the email address and try again."));
    } finally {
      setIsRequestingCode(false);
    }
  };

  const handleVerifyCode = async () => {
    if (isVerifyingCode || !loginData.email || !loginData.code) return;

    setIsVerifyingCode(true);
    setLoginError('');

    try {
      const isDemoEmail = loginData.email.trim().toLowerCase() === DEMO_LOGIN_EMAIL;
      const anonymousId = await getAnonymousId();
      const data = await api.verifyLoginCode(
        loginData.email,
        loginData.code,
        isDemoEmail ? DEMO_COOP_ID : undefined,
        anonymousId
      );
      console.log('📥 Verify code response:', JSON.stringify(data, null, 2));

      if (data.success && data.user) {
        console.log('✅ Code verified successfully, logging in...');
        const user = {
          ...data.user,
          createdAt: new Date(data.user.createdAt),
          profileOnboardingCompletedAt: data.user.profileOnboardingCompletedAt
            ? new Date(data.user.profileOnboardingCompletedAt)
            : null,
        };
        console.log('👤 User data:', user);
        await login(user);
        if (anonymousId) {
          void clearAnonymousId();
        }
        console.log('🎉 Login complete!');
        router.replace('/(tabs)' as any);
      } else {
        const errorMsg = "That code didn't work. Check the code in your email, or tap Resend to get a new one.";
        console.error('❌ Verification failed:', errorMsg);
        console.error('📦 Full response:', data);
        setLoginError(errorMsg);
      }
    } catch (error) {
      console.error('Verify code error:', error);
      setLoginError(
        friendlyError(error, "That code didn't work. Check the code in your email, or tap Resend to get a new one."),
      );
    } finally {
      setIsVerifyingCode(false);
    }
  };


  const renderWaitlistCard = () => (
    <Card className="bg-card border-border overflow-hidden">
      <CardContent className="p-5">
        <View className="flex-row items-start gap-3 mb-4">
          <View className="h-11 w-11 rounded-2xl bg-primary/20 items-center justify-center">
            <Icon as={Mail} size={20} className="text-primary" />
          </View>
          <View className="flex-1">
            <Text className="text-foreground text-xl font-black">Join the waitlist</Text>
            <Text className="text-muted-foreground text-sm leading-5 mt-1">
              Not sure which commons fits yet? Get early access and updates first.
            </Text>
          </View>
        </View>

        <View className="flex-row gap-3">
          <Input
            value={waitlistData.email}
            onChangeText={(email) => {
              setWaitlistData((prev) => ({ ...prev, email }));
              setWaitlistStatus('idle');
              setWaitlistMessage('');
            }}
            className="flex-1 h-12 rounded-xl border-input bg-muted text-foreground"
            placeholder="Email address"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            autoCorrect={false}
          />
          <Button
            onPress={handleWaitlistSignup}
            disabled={waitlistStatus === 'submitting' || !waitlistData.email.trim()}
            className="h-12 rounded-xl bg-primary px-4"
          >
            <Text className="text-primary-foreground font-black">
              {waitlistStatus === 'submitting' ? 'Joining...' : 'Join'}
            </Text>
          </Button>
        </View>

        {waitlistMessage ? (
          <View
            className={`mt-4 rounded-xl border p-3 ${
              waitlistStatus === 'success'
                ? 'border-green-500/30 bg-green-500/10'
                : 'border-red-500/30 bg-red-500/10'
            }`}
          >
            <View className="flex-row gap-2">
              <Icon
                as={waitlistStatus === 'success' ? CheckCircle2 : Shield}
                size={16}
                className={waitlistStatus === 'success' ? 'text-green-400' : 'text-red-300'}
              />
              <Text className={`flex-1 text-sm ${waitlistStatus === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                {waitlistMessage}
              </Text>
            </View>
          </View>
        ) : null}
      </CardContent>
    </Card>
  );

  const renderBrowseCoops = () => (
    <View className="flex-1 bg-background">
      {/* Sticky Header */}
      <View className="bg-background border-b border-border p-6 pb-4">
        <View className="w-full max-w-md mx-auto">
          <View>
            <View className="bg-primary/15 p-3 rounded-2xl mb-4 self-start">
              <Icon as={Store} size={28} className="text-primary" />
            </View>
            <Text className="text-3xl font-black text-foreground mb-2">Choose Your Commons</Text>
            <Text className="text-muted-foreground leading-6">
              Explore live communities, then apply when one feels aligned with your goals.
            </Text>
          </View>
        </View>
      </View>

      {/* Scrollable Commons List */}
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 16 }}>
        <View className="w-full max-w-md mx-auto">
          <View className="mb-4">
            {renderWaitlistCard()}
          </View>

          {/* Loading State */}
          {isLoadingCoops && (
            <View className="items-center py-8">
              <ActivityIndicator size="large" color="#FF6B00" />
              <Text className="text-muted-foreground mt-4">Loading available commons...</Text>
            </View>
          )}

          {/* Commons Cards */}
          {!isLoadingCoops && coopsWithIcons.length > 0 && (
            <View className="gap-4">
              {coopsWithIcons.map((coop) => {
                // Helper function to determine if a color is dark (needs white text)
                const isColorDark = (color: string): boolean => {
                  if (!color) return false;
                  
                  // If it's a hex color, calculate luminance
                  if (color.startsWith('#')) {
                    const hex = color.replace('#', '');
                    const r = parseInt(hex.substr(0, 2), 16);
                    const g = parseInt(hex.substr(2, 2), 16);
                    const b = parseInt(hex.substr(4, 2), 16);
                    // Calculate relative luminance
                    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                    return luminance < 0.5;
                  }
                  
                  // If it's a Tailwind class, check for dark colors
                  return color.includes('red-') || color.includes('blue-') || 
                         color.includes('purple-') || color.includes('gold-') ||
                         color.includes('gray-7') || color.includes('gray-8') ||
                         color.includes('gray-9') || color.includes('black');
                };
                
                // Parse color - could be hex (#2563eb) or Tailwind class (bg-blue-700)
                const isHexColor = coop.bgColor?.startsWith('#');
                const bgColorStyle = isHexColor ? coop.bgColor : undefined;
                const bgColorClass = !isHexColor && coop.bgColor ? coop.bgColor : 'bg-card';
                
                // Determine text color based on background luminance
                const useWhiteText = coop.bgColor ? isColorDark(coop.bgColor || '') : false;
                const textColorClass = useWhiteText ? 'text-white' : 'text-foreground';
                const subtextColorClass = useWhiteText ? 'text-white' : 'text-foreground';
                
                return (
                  <Pressable key={coop.id} onPress={() => selectCoop(coop.id)}>
                    <Card 
                      className={`${bgColorClass} border-border overflow-hidden`}
                      style={bgColorStyle ? { backgroundColor: bgColorStyle } : undefined}
                    >
                      <CardContent className="p-6">
                        <View className="flex-row items-start justify-between gap-4 mb-4">
                          <View className="flex-1">
                            <Text className={`text-2xl font-black ${textColorClass} mb-1`}>{coop.name}</Text>
                            <Text className={`${subtextColorClass} font-semibold`}>{coop.tagline}</Text>
                          </View>
                          <View className="h-10 w-10 rounded-xl bg-primary/10 items-center justify-center">
                            <Icon as={ChevronRight} size={20} className={textColorClass} />
                          </View>
                        </View>
                        <Text className={`${subtextColorClass} text-sm leading-6 mb-4`}>{coop.description}</Text>
                        <View className="flex flex-row items-center justify-between">
                          <Badge className={useWhiteText ? "bg-white/20" : "bg-primary/15"}>
                            <Text className={`text-sm font-semibold ${useWhiteText ? 'text-white' : 'text-foreground'}`}>Learn More</Text>
                          </Badge>
                        </View>
                      </CardContent>
                    </Card>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* No Commons Available */}
          {!isLoadingCoops && coopsWithIcons.length === 0 && (
            <View className="items-center py-8">
              <Text className="text-muted-foreground text-center">No commons available at this time.</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky Footer */}
      <View className="bg-background border-t border-border p-6 pt-4">
        <View className="w-full max-w-md mx-auto">
          <View className="flex flex-row justify-between items-center">
            <Button variant="ghost" onPress={goToLogin}>
              <Icon as={ChevronLeft} size={16} className="text-muted-foreground" />
              <Text className="text-muted-foreground ml-1">Back</Text>
            </Button>
            <Button variant="ghost" onPress={goToLogin}>
              <Text className="text-muted-foreground">Already a member? </Text>
              <Text className="text-primary font-semibold">Sign In</Text>
            </Button>
          </View>
        </View>
      </View>
    </View>
  );

  const renderCoopDetails = () => {
    const selectedCoop = coopsWithIcons.find(c => c.id === selectedCoopId);
    if (!selectedCoop) return null;

    return (
      <ScrollView className="flex-1 bg-background">
        <View className="min-h-screen flex-1 p-6">
          <View className="w-full max-w-md mx-auto">
            {/* Header */}
            <View className="mb-6">
              <View className="flex-row items-center justify-between mb-5">
                <Button variant="ghost" onPress={prevStep} className="px-0">
                  <Icon as={ChevronLeft} size={16} className="text-muted-foreground" />
                  <Text className="text-muted-foreground ml-1">Commons</Text>
                </Button>
                <Button variant="ghost" onPress={goToLogin} className="px-0">
                  <Text className="text-primary font-semibold">Sign in</Text>
                </Button>
              </View>
              <View className="bg-primary/15 p-3 rounded-2xl mb-4 self-start">
                <Icon as={Heart} size={28} className="text-primary" />
              </View>
              <Text className="text-4xl font-black text-foreground mb-2">{selectedCoop.name}</Text>
              <Text className="text-lg text-primary font-semibold">{selectedCoop.tagline}</Text>
            </View>

            {/* Mission */}
            <Card className="bg-card border-border mb-4">
              <CardContent className="p-5">
                <Text className="font-semibold text-foreground mb-2">Mission</Text>
                <Text className="text-muted-foreground text-sm leading-relaxed">{selectedCoop.mission}</Text>
              </CardContent>
            </Card>

            {/* Features */}
            <Card className="bg-card border-border mb-4">
              <CardContent className="p-5">
                <Text className="font-semibold text-foreground mb-4">What You Get</Text>
                <View className="gap-4">
                  {selectedCoop.features.map((feature, index) => (
                    <View key={index} className="flex flex-row gap-3">
                      <View className="bg-primary/15 p-2 rounded-lg h-10 w-10 items-center justify-center">
                        <Icon as={feature.icon} size={20} className="text-primary" />
                      </View>
                      <View className="flex-1">
                        <Text className="font-medium text-foreground">{feature.title}</Text>
                        <Text className="text-sm text-muted-foreground">{feature.description}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </CardContent>
            </Card>

            {/* Eligibility */}
            <Card className="bg-primary/10 border-primary/25 mb-6">
              <CardContent className="p-4">
                <View className="flex flex-row items-start gap-2">
                  <Icon as={Shield} size={20} className="text-primary mt-0.5" />
                  <View className="flex-1">
                    <Text className="font-medium text-primary mb-1">Eligibility</Text>
                    <Text className="text-sm text-muted-foreground">{selectedCoop.eligibility}</Text>
                  </View>
                </View>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <View className="gap-3 mb-6">
              <Button className="bg-primary h-12 rounded-xl" onPress={startApplication}>
                <Text className="text-primary-foreground font-black">Apply to Join {selectedCoop.name}</Text>
                <Icon as={ChevronRight} size={16} className="text-primary-foreground ml-2" />
              </Button>
              <Button variant="outline" onPress={prevStep} className="border-border bg-card h-12 rounded-xl">
                <Icon as={ChevronLeft} size={16} className="text-foreground" />
                <Text className="text-foreground ml-1">Back to Commons</Text>
              </Button>
            </View>

            {/* Login Link */}
            <View className="items-center">
              <Button variant="ghost" onPress={goToLogin}>
                <Text className="text-muted-foreground">Already a member? </Text>
                <Text className="text-primary font-semibold">Sign In</Text>
              </Button>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  };

  const renderPersonalInfo = () => {
    const selectedCoop = coopsWithIcons.find(c => c.id === selectedCoopId);
    
    return (
    <ScrollView className="flex-1 bg-background">
      <View className="min-h-screen flex-1 justify-center p-6">
        <View className="w-full max-w-md mx-auto">
          {/* Header */}
          <View className="items-center mb-8">
            <View className="bg-primary p-3 rounded-full mb-4">
              <Icon as={Building} size={32} className="text-white" />
            </View>
            <Text className="text-2xl font-bold text-foreground mb-2 text-center">
              Join {selectedCoop?.name || 'Commons'}
            </Text>
            <Text className="text-muted-foreground text-center">Step 1 of 4: Personal Information</Text>
          </View>

          <Card className="bg-white border-border">
            <CardContent className="p-6">
              <View className="gap-4">
                {/* Name Fields */}
                <View className="flex flex-row gap-3">
                  <View className="flex-1">
                    <Label className="text-foreground">First Name</Label>
                    <Input
                      value={formData.firstName}
                      onChangeText={(text) => handleInputChange('firstName', text)}
                      className="mt-1 border-input"
                      placeholder="Marcus"
                    />
                  </View>
                  <View className="flex-1">
                    <Label className="text-foreground">Last Name</Label>
                    <Input
                      value={formData.lastName}
                      onChangeText={(text) => handleInputChange('lastName', text)}
                      className="mt-1 border-input"
                      placeholder="Johnson"
                    />
                  </View>
                </View>

                {/* Email */}
                <View>
                  <Label className="text-foreground">Email</Label>
                  <Input
                    value={formData.email}
                    onChangeText={(text) => handleInputChange('email', text)}
                    className="mt-1 border-input"
                    placeholder="marcus@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    textContentType="emailAddress"
                    autoCorrect={false}
                  />
                </View>

                {/* Phone */}
                <View>
                  <Label className="text-foreground">Phone Number</Label>
                  <Input
                    value={formData.phone}
                    onChangeText={(text) => handleInputChange('phone', text)}
                    className="mt-1 border-input"
                    placeholder="(555) 123-4567"
                    keyboardType="phone-pad"
                  />
                </View>

              </View>
            </CardContent>
          </Card>

          {errorMessage ? (
            <View accessibilityRole="alert" className="bg-red-50 border border-red-300 rounded-xl p-4 mt-6">
              <Text className="text-red-800 text-base whitespace-pre-line">{errorMessage}</Text>
            </View>
          ) : null}

          {/* Navigation */}
          <View className="flex flex-row justify-between items-center mt-6">
            <Button variant="ghost" onPress={prevStep}>
              <Icon as={ChevronLeft} size={16} className="text-muted-foreground" />
              <Text className="text-muted-foreground ml-1">Back</Text>
            </Button>
            <Button onPress={continuePastPersonalInfo} className="bg-primary">
              <Text className="text-white font-semibold">Continue</Text>
              <Icon as={ChevronRight} size={16} className="text-white ml-1" />
            </Button>
          </View>

          {/* Login Link */}
          <View className="items-center mt-6">
            <Button variant="ghost" onPress={goToLogin}>
              <Text className="text-muted-foreground">Have an account? </Text>
              <Text className="font-semibold text-primary">Sign In</Text>
            </Button>
          </View>
        </View>
      </View>
    </ScrollView>
    );
  };

  const renderApplicationQuestions = () => {
    const selectedCoop = coopsWithIcons.find(c => c.id === selectedCoopId);
    
    return (
    <ScrollView className="flex-1 bg-background">
      <View className="min-h-screen flex-1 justify-center p-6">
        <View className="w-full max-w-md mx-auto">
          {/* Header */}
          <View className="items-center mb-8">
            <View className="bg-primary p-3 rounded-full mb-4">
              <Icon as={Heart} size={32} className="text-white" />
            </View>
            <Text className="text-2xl font-bold text-foreground mb-2 text-center">
              {selectedCoop?.name} Application
            </Text>
            <Text className="text-muted-foreground text-center">Step 2 of 4: Tell us about yourself</Text>
          </View>

          {isLoadingQuestions ? (
            <Card className="bg-white border-border">
              <CardContent className="p-6">
                <View className="items-center justify-center py-8">
                  <ActivityIndicator size="large" color="#FF6B00" />
                  <Text className="text-muted-foreground mt-4">Loading questions...</Text>
                </View>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-white border-border">
              <CardContent className="p-6">
                <View className="gap-6">
                  {applicationQuestions.map((question) => renderDynamicQuestion(question))}
                  
                  {applicationQuestions.length === 0 && (
                    <View className="items-center py-8">
                      <Text className="text-muted-foreground">No questions available for this commons.</Text>
                    </View>
                  )}
                </View>
              </CardContent>
            </Card>
          )}

          {errorMessage ? (
            <View accessibilityRole="alert" className="bg-red-50 border border-red-300 rounded-xl p-4 mt-6">
              <Text className="text-red-800 text-base whitespace-pre-line">{errorMessage}</Text>
            </View>
          ) : null}

          {/* Navigation */}
          <View className="flex flex-row justify-between items-center mt-6">
            <Button variant="ghost" onPress={prevStep}>
              <Icon as={ChevronLeft} size={16} className="text-muted-foreground" />
              <Text className="text-muted-foreground ml-1">Back</Text>
            </Button>
            <Button
              onPress={continuePastQuestions}
              disabled={isLoadingQuestions}
              className="bg-primary"
            >
              <Text className="text-white font-semibold">Continue</Text>
              <Icon as={ChevronRight} size={16} className="text-white ml-1" />
            </Button>
          </View>
        </View>
      </View>
    </ScrollView>
    );
  };

  const renderMediaUpload = () => {
    const apiUrl = getApiUrl();

    return (
      <ScrollView className="flex-1 bg-background">
        <View className="min-h-screen flex-1 justify-center p-6">
          <View className="w-full max-w-md mx-auto">
            {/* Header */}
            <View className="items-center mb-8">
            <View className="bg-primary p-3 rounded-full mb-4">
                <Icon as={Camera} size={32} className="text-white" />
              </View>
              <Text className="text-2xl font-bold text-foreground mb-2 text-center">
                Introduce Yourself
              </Text>
              <Text className="text-muted-foreground text-center">
                Step 3 of 4: Share a video and photo (optional but recommended)
              </Text>
            </View>

            <Card className="bg-white border-border">
              <CardContent className="p-6">
                {/* Video Upload */}
                <View className="mb-6">
                  <VideoUpload
                    onUploadComplete={(cid, url) => {
                      handleInputChange('videoCID', cid);
                    }}
                    apiUrl={apiUrl}
                  />
                </View>

                {/* Photo Upload */}
                <View className="border-t border-border pt-6">
                  <PhotoUpload
                    onUploadComplete={(cid, url) => {
                      handleInputChange('photoCID', cid);
                    }}
                    apiUrl={apiUrl}
                    title="Profile Photo"
                    description="Upload a clear photo of yourself"
                  />
                </View>

                {/* Info */}
                <View className="bg-secondary border border-border rounded-2xl p-4 mt-6">
                  <Text className="text-sm text-foreground font-semibold mb-2">Why upload media?</Text>
                  <Text className="text-sm text-muted-foreground">
                    • Helps community members get to know you{'\n'}
                    • Increases your application approval chances{'\n'}
                    • Builds trust in the commons{'\n'}
                    • Shows commitment to transparency
                  </Text>
                </View>
              </CardContent>
            </Card>

            {/* Navigation */}
            <View className="flex flex-row justify-between items-center mt-6">
              <Button variant="ghost" onPress={prevStep}>
                <Icon as={ChevronLeft} size={16} className="text-muted-foreground" />
                <Text className="text-muted-foreground ml-1">Back</Text>
              </Button>
              <Button
                onPress={nextStep}
                className="bg-primary"
              >
                <Text className="text-white font-semibold">
                  {formData.videoCID && formData.photoCID ? 'Continue' : 'Skip for Now'}
                </Text>
                <Icon as={ChevronRight} size={16} className="text-white ml-1" />
              </Button>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  };

  const renderCommitmentQuestions = () => {
    const selectedCoop = coopsWithIcons.find(c => c.id === selectedCoopId);

    return (
    <ScrollView className="flex-1 bg-background">
      <View className="min-h-screen flex-1 justify-center p-6">
        <View className="w-full max-w-md mx-auto">
          {/* Header */}
          <View className="items-center mb-8">
            <View className="bg-primary p-3 rounded-full mb-4">
              <Icon as={Shield} size={32} className="text-white" />
            </View>
            <Text className="text-2xl font-bold text-foreground mb-2 text-center">
              {selectedCoop?.name} Application
            </Text>
            <Text className="text-muted-foreground text-center">Step 4 of 4: Review & Submit</Text>
          </View>

          <Card className="bg-white border-border">
            <CardContent className="p-6">
              <View className="gap-6">
                {/* Terms Agreement */}
                <View className="gap-3 pt-4 border-t border-border">
                  <View className="flex flex-row items-start gap-3">
                    <Checkbox
                      checked={formData.agreeToCoopValues}
                      onCheckedChange={(checked) => handleInputChange('agreeToCoopValues', !!checked)}
                    />
                    <Text className="text-foreground font-medium flex-1">
                      I align with this commons&apos; values and mission
                    </Text>
                  </View>

                  <View className="flex flex-row items-start gap-3">
                    <Checkbox
                      checked={formData.agreeToTerms}
                      onCheckedChange={(checked) => handleInputChange('agreeToTerms', !!checked)}
                    />
                    <Text className="text-foreground font-medium flex-1">
                      I agree to the Terms of Service and Community Charter
                    </Text>
                  </View>

                  <View className="flex flex-row items-start gap-3">
                    <Checkbox
                      checked={formData.agreeToPrivacy}
                      onCheckedChange={(checked) => handleInputChange('agreeToPrivacy', !!checked)}
                    />
                    <Text className="text-foreground font-medium flex-1">
                      I agree to the Privacy Policy
                    </Text>
                  </View>
                </View>
              </View>
            </CardContent>
          </Card>

          {/* Error Message Display */}
          {errorMessage && (
            <Card className="bg-red-50 border-red-300 mt-6">
              <CardContent className="p-4">
                <View className="flex flex-row items-start gap-3">
                  <Text className="text-2xl">⚠️</Text>
                  <View className="flex-1">
                    <Text className="font-bold text-red-800 mb-1">Please check the form</Text>
                    <Text className="text-red-700 text-sm whitespace-pre-line">{errorMessage}</Text>
                  </View>
                </View>
              </CardContent>
            </Card>
          )}

          {/* Navigation */}
          <View className="flex flex-row justify-between items-center mt-6">
            <Button variant="ghost" onPress={prevStep}>
              <Icon as={ChevronLeft} size={16} className="text-muted-foreground" />
              <Text className="text-muted-foreground ml-1">Back</Text>
            </Button>
            <Button
              onPress={handleSubmitApplication}
              disabled={submissionStatus !== 'idle' || isSubmitting}
              className={submissionStatus === 'success' ? 'bg-green-600' : 'bg-primary'}
            >
              <Text className="text-white font-semibold">
                {submissionStatus === 'submitting' && '⏳ Submitting...'}
                {submissionStatus === 'success' && '✅ Success!'}
                {submissionStatus === 'idle' && 'Submit Application'}
              </Text>
              {submissionStatus === 'idle' && <Icon as={ChevronRight} size={16} className="text-white ml-1" />}
            </Button>
          </View>
        </View>
      </View>
    </ScrollView>
    );
  };

  const renderApplicationSubmitted = () => {
    const selectedCoop = coopsWithIcons.find(c => c.id === selectedCoopId);
    
    return (
    <ScrollView className="flex-1 bg-background">
      <View className="min-h-screen flex-1 justify-center p-6">
        <View className="w-full max-w-md mx-auto">
          {/* Header */}
          <View className="items-center mb-8">
            <View className="bg-green-600 p-4 rounded-full mb-4">
              <Icon as={Award} size={40} className="text-white" />
            </View>
            <Text className="text-2xl font-bold text-foreground mb-2 text-center">Application Submitted!</Text>
            <Text className="text-muted-foreground text-center">
              Welcome to the {selectedCoop?.name} community review process
            </Text>
          </View>

          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-6">
              <Text className="font-semibold text-green-800 mb-4">What happens next?</Text>
              <View className="gap-4">
                <View className="flex flex-row items-start gap-3">
                  <View className="bg-green-600 rounded-full w-6 h-6 items-center justify-center">
                    <Text className="text-sm font-bold text-white">1</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="font-medium text-foreground">Community Review</Text>
                    <Text className="text-sm text-muted-foreground">
                      Current {selectedCoop?.name} members will review your application (1-2 weeks)
                    </Text>
                  </View>
                </View>
                <View className="flex flex-row items-start gap-3">
                  <View className="bg-green-600 rounded-full w-6 h-6 items-center justify-center">
                    <Text className="text-sm font-bold text-white">2</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="font-medium text-foreground">Community Interview</Text>
                    <Text className="text-sm text-muted-foreground">You may be invited to meet with community members</Text>
                  </View>
                </View>
                <View className="flex flex-row items-start gap-3">
                  <View className="bg-green-600 rounded-full w-6 h-6 items-center justify-center">
                    <Text className="text-sm font-bold text-white">3</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="font-medium text-foreground">Welcome to {selectedCoop?.name}</Text>
                    <Text className="text-sm text-muted-foreground">
                      If approved, you&apos;ll receive onboarding materials and access
                    </Text>
                  </View>
                </View>
              </View>
            </CardContent>
          </Card>

          {applicationReference ? (
            <Card className="bg-gold-50 border-gold-200 mt-6">
              <CardContent className="p-4">
                <View className="flex flex-row items-center gap-2">
                  <Icon as={Building} size={20} className="text-primary" />
                  <View className="flex-1">
                    <Text className="font-medium text-gold-800">
                      Your reference number: {applicationReference}
                    </Text>
                    <Text className="text-sm text-gold-800">
                      Keep this number. If you contact us about your application, share it so we can find it quickly.
                    </Text>
                  </View>
                </View>
              </CardContent>
            </Card>
          ) : null}

          {/* Action Button */}
          <View className="mt-8">
            <Button className="w-full bg-primary" onPress={goToLogin}>
              <Text className="text-white font-semibold">Continue to Sign In</Text>
            </Button>
          </View>

          {/* Community Message */}
          {selectedCoop?.tagline ? (
            <View className="items-center mt-6">
              <Badge className={selectedCoop.bgColor || 'bg-primary'}>
                <Text className="text-white font-medium">{selectedCoop.tagline}</Text>
              </Badge>
            </View>
          ) : null}
        </View>
      </View>
    </ScrollView>
    );
  };

  const renderLogin = () => (
    <ScrollView className="flex-1 bg-background">
      <View className="min-h-screen flex-1 justify-center p-6">
        <View className="w-full max-w-md mx-auto">
          {onBack && (
            <Pressable
              onPress={onBack}
              className="flex-row items-center self-start mb-4"
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Icon as={ChevronLeft} size={16} className="text-muted-foreground" />
              <Text className="text-muted-foreground ml-1">Back</Text>
            </Pressable>
          )}
          {/* Header */}
          <View className="items-center mb-8">
            <View className="bg-primary p-3 rounded-full mb-4">
              <Icon as={Building} size={32} className="text-white" />
            </View>
            <Text className="text-3xl font-black text-foreground mb-2 text-center">Sign in</Text>
            <Text className="text-muted-foreground text-center text-base leading-6">
              {codeSent
                ? "We emailed you a 6-digit code. Type it below. If you don't see it, check your spam folder."
                : "Type your email and we'll send you a 6-digit code. No password needed."}
            </Text>
          </View>

          <Card className="bg-white border-border">
            <CardContent className="p-6">
              <View className="gap-5">
                {/* Email */}
                <View>
                  <Label className="text-foreground">Email address</Label>
                  <Input
                    value={loginData.email}
                    onChangeText={(text) => setLoginData(prev => ({ ...prev, email: text }))}
                    className="mt-1 border-input"
                    placeholder="name@email.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    textContentType="emailAddress"
                    autoCorrect={false}
                    editable={!codeSent}
                  />
                </View>

                {/* Code Input - shown after code is sent */}
                {codeSent && (
                  <View>
                    <Label className="text-foreground">Verification Code</Label>
                    <Input
                      value={loginData.code}
                      onChangeText={(text) => setLoginData(prev => ({ ...prev, code: text }))}
                      className="mt-1 border-input"
                      placeholder="Enter 6-digit code"
                      keyboardType="number-pad"
                      autoComplete="one-time-code"
                      textContentType="oneTimeCode"
                      maxLength={6}
                      autoFocus
                    />
                  </View>
                )}

                {/* Error Message */}
                {loginError && (
                  <View className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <Text className="text-red-700 text-sm">{loginError}</Text>
                  </View>
                )}

                {/* Submit Button */}
                {!codeSent ? (
                  <Button
                    className="h-auto min-h-16 w-full bg-primary px-4 py-4"
                    onPress={handleRequestCode}
                    disabled={isRequestingCode || !loginData.email}
                  >
                    <Text className="text-center text-white font-semibold">
                      {isRequestingCode ? 'Sending Code...' : 'Log in with code'}
                    </Text>
                  </Button>
                ) : (
                  <View className="gap-3">
                    <Button
                      className="h-auto min-h-16 w-full bg-primary px-4 py-4"
                      onPress={handleVerifyCode}
                      disabled={isVerifyingCode || !loginData.code || loginData.code.length !== 6}
                    >
                      <Text className="text-center text-white font-semibold">
                        {isVerifyingCode ? 'Verifying...' : 'Verify & Sign In'}
                      </Text>
                    </Button>

                    {/* Resend Code Button */}
                    <Button
                      variant="outline"
                      className="h-auto min-h-14 w-full border-input px-4 py-3"
                      onPress={handleRequestCode}
                      disabled={!canResend || isRequestingCode}
                    >
                      <Text className="text-center text-foreground">
                        {canResend ? 'Resend Code' : `Resend in ${resendTimer}s`}
                      </Text>
                    </Button>

                    {/* Change Email Button */}
                    <Button
                      variant="ghost"
                      className="w-full"
                      onPress={() => {
                        setCodeSent(false);
                        setLoginData(prev => ({ ...prev, code: '' }));
                        setLoginError('');
                      }}
                    >
                      <Text className="text-primary">Change Email</Text>
                    </Button>
                  </View>
                )}
              </View>
            </CardContent>
          </Card>

          {/* Signup Link */}
          <View className="items-center mt-6">
            <Button variant="ghost" onPress={goToBrowseCoops}>
              <Text className="text-foreground">Don&apos;t have an account? </Text>
              <Text className="font-semibold text-primary">Join a Commons</Text>
            </Button>
          </View>

        </View>
      </View>
    </ScrollView>
  );

  // Determine which step to render
  // Flow: Browse Commons → Commons Details → Personal Info → Questions → Media Upload → Commitment → Success → Login
  const renderCurrentStep = () => {
    const browseCoopsStep = BROWSE_STEP;
    const coopDetailsStep = BROWSE_STEP + 1;
    const personalInfoStep = BROWSE_STEP + 2;
    const questionsStep = BROWSE_STEP + 3;
    const mediaUploadStep = BROWSE_STEP + 4;
    const commitmentStep = BROWSE_STEP + 5;
    const successStep = BROWSE_STEP + 6;

    if (currentStep === browseCoopsStep) {
      return renderBrowseCoops();
    } else if (currentStep === coopDetailsStep) {
      return renderCoopDetails();
    } else if (currentStep === personalInfoStep) {
      return renderPersonalInfo();
    } else if (currentStep === questionsStep) {
      return renderApplicationQuestions();
    } else if (currentStep === mediaUploadStep) {
      return renderMediaUpload();
    } else if (currentStep === commitmentStep) {
      return renderCommitmentQuestions();
    } else if (currentStep === successStep) {
      return renderApplicationSubmitted();
    } else {
      return renderLogin();
    }
  };

  return renderCurrentStep();
}
