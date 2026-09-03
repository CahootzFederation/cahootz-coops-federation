import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, CalendarDays, FileText, Image, Link as LinkIcon, MapPin, Newspaper, Send } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, resolveCoopId } from '@/lib/api';
import { coopConfig } from '@/lib/coop-config';
import { resolveBrandColor, withAlpha } from '@/lib/brand-colors';

type SubmissionType = 'article' | 'event';

export default function SubmitNewsletterScreen() {
  const { user, sessionToken } = useAuth();
  const config = coopConfig();
  const primaryColor = resolveBrandColor(user?.coop?.primaryColor || config.primaryColor, '#B45309');
  const accentColor = resolveBrandColor(user?.coop?.accentColor || config.accentColor, '#16A34A');
  const [type, setType] = useState<SubmissionType>('article');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [date, setDate] = useState('');
  const [location, setLocation] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim().length >= 3 && summary.trim().length >= 10 && !submitting;

  const submit = async () => {
    let walletAddress = user?.walletAddress || null;
    if (!walletAddress && user?.id) {
      const walletInfo = await api.getWalletInfo(user.id, user.walletAddress, sessionToken).catch(() => null);
      walletAddress = walletInfo?.address || null;
    }

    if (!walletAddress) {
      Alert.alert('Wallet Required', 'You need a wallet on your account before submitting to the newsletter.');
      return;
    }

    if (!canSubmit) {
      Alert.alert('Add More Detail', 'Please add a title and a short write-up before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      await api.submitNewsletterSubmission(
        {
          coopId: user?.coop?.id || resolveCoopId(),
          type,
          title: title.trim(),
          summary: summary.trim(),
          date: date.trim() || undefined,
          location: type === 'event' ? location.trim() || undefined : undefined,
          ctaUrl: ctaUrl.trim() || undefined,
          imageUrl: imageUrl.trim() || undefined,
        },
        walletAddress
      );

      Alert.alert(
        'Submitted',
        'Thanks. Your submission went to the commons newsletter inbox for review.',
        [{ text: 'Done', onPress: () => router.back() }]
      );
    } catch (error: any) {
      Alert.alert('Submission Failed', error.message || 'Could not submit to the newsletter.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
          <View className="px-5 py-4">
            <View className="mb-5 flex-row items-center">
              <TouchableOpacity
                onPress={() => router.back()}
                className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-white"
                activeOpacity={0.75}
              >
                <ArrowLeft size={20} color="#111827" />
              </TouchableOpacity>
              <View className="flex-1">
                <Text className="text-2xl font-bold text-gray-900">Submit to Newsletter</Text>
                <Text className="mt-1 text-sm text-gray-500">
                  Send a story or event to the commons paper.
                </Text>
              </View>
            </View>

            <View className="mb-5 rounded-2xl border border-gray-100 bg-white p-4">
              <View className="mb-3 flex-row items-center">
                <View
                  className="mr-3 h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: withAlpha(primaryColor, '1A') }}
                >
                  <Newspaper size={20} color={primaryColor} />
                </View>
                <View className="flex-1">
                  <Text className="font-semibold text-gray-900">Community paper inbox</Text>
                  <Text className="text-sm leading-5 text-gray-500">
                    The commons can review, edit, and publish your submission.
                  </Text>
                </View>
              </View>

              <View className="flex-row rounded-xl bg-gray-100 p-1">
                {[
                  { key: 'article', label: 'Story', icon: FileText },
                  { key: 'event', label: 'Event', icon: CalendarDays },
                ].map((option) => {
                  const Icon = option.icon;
                  const selected = type === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setType(option.key as SubmissionType)}
                      className="flex-1 flex-row items-center justify-center rounded-lg py-3"
                      style={{ backgroundColor: selected ? primaryColor : 'transparent' }}
                      activeOpacity={0.8}
                    >
                      <Icon size={16} color={selected ? '#FFFFFF' : '#6B7280'} />
                      <Text className={`ml-2 text-sm font-semibold ${selected ? 'text-white' : 'text-gray-600'}`}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View className="rounded-2xl border border-gray-100 bg-white p-4">
              <Text className="mb-2 text-sm font-semibold text-gray-800">Headline</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={type === 'event' ? 'Community business mixer' : 'Why our block is organizing now'}
                placeholderTextColor="#9CA3AF"
                className="rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
                maxLength={120}
              />

              <Text className="mb-2 mt-4 text-sm font-semibold text-gray-800">
                {type === 'event' ? 'Event details' : 'Story details'}
              </Text>
              <TextInput
                value={summary}
                onChangeText={setSummary}
                placeholder={
                  type === 'event'
                    ? 'What is happening, who should come, and why it matters.'
                    : 'Tell the commons what happened, who is involved, and why members should care.'
                }
                placeholderTextColor="#9CA3AF"
                className="min-h-[140px] rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
                multiline
                textAlignVertical="top"
                maxLength={1200}
              />

              <View className="mt-4">
                <View className="mb-2 flex-row items-center">
                  <CalendarDays size={15} color="#6B7280" />
                  <Text className="ml-2 text-sm font-semibold text-gray-800">
                    {type === 'event' ? 'Date / time' : 'Issue note'}
                  </Text>
                </View>
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder={type === 'event' ? 'Saturday, July 18 at 2 PM' : 'This week, Spring 2026, or leave blank'}
                  placeholderTextColor="#9CA3AF"
                  className="rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
                  maxLength={80}
                />
              </View>

              {type === 'event' && (
                <View className="mt-4">
                  <View className="mb-2 flex-row items-center">
                    <MapPin size={15} color="#6B7280" />
                    <Text className="ml-2 text-sm font-semibold text-gray-800">Location</Text>
                  </View>
                  <TextInput
                    value={location}
                    onChangeText={setLocation}
                    placeholder="Community center, Zoom, storefront, park..."
                    placeholderTextColor="#9CA3AF"
                    className="rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
                    maxLength={160}
                  />
                </View>
              )}

              <View className="mt-4">
                <View className="mb-2 flex-row items-center">
                  <LinkIcon size={15} color="#6B7280" />
                  <Text className="ml-2 text-sm font-semibold text-gray-800">Link URL optional</Text>
                </View>
                <TextInput
                  value={ctaUrl}
                  onChangeText={setCtaUrl}
                  placeholder="https://..."
                  placeholderTextColor="#9CA3AF"
                  className="rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
                  autoCapitalize="none"
                  keyboardType="url"
                  maxLength={500}
                />
              </View>

              <View className="mt-4">
                <View className="mb-2 flex-row items-center">
                  <Image size={15} color="#6B7280" />
                  <Text className="ml-2 text-sm font-semibold text-gray-800">Image URL optional</Text>
                </View>
                <TextInput
                  value={imageUrl}
                  onChangeText={setImageUrl}
                  placeholder="https://..."
                  placeholderTextColor="#9CA3AF"
                  className="rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
                  autoCapitalize="none"
                  keyboardType="url"
                  maxLength={500}
                />
              </View>
            </View>

            <TouchableOpacity
              onPress={submit}
              disabled={!canSubmit}
              className="mt-5 flex-row items-center justify-center rounded-2xl py-4"
              style={{ backgroundColor: canSubmit ? primaryColor : '#D1D5DB' }}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Send size={18} color="#FFFFFF" />
                  <Text className="ml-2 font-semibold text-white">Send to Commons</Text>
                </>
              )}
            </TouchableOpacity>

            <Text className="mt-3 text-center text-xs leading-5 text-gray-500">
              Submissions are reviewed before appearing on the public newsletter.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
