import React from 'react';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check, ImagePlus, Send, Trash2 } from 'lucide-react-native';

import {
  COMPOSER_MEDIA_TILE_SIZE,
  CommonsMediaTile,
} from '@/components/commons-media-viewer';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type FeedbackCategory } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';

const THEME = {
  paper: '#F8FAFC',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
  muted: '#64748B',
  danger: '#DC2626',
};

const MAX_SCREENSHOTS = 4;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'BUG', label: 'Something is broken' },
  { value: 'COMPLAINT', label: 'Complaint' },
  { value: 'IDEA', label: 'Idea' },
  { value: 'OTHER', label: 'Other' },
];

type Screenshot = {
  uri: string;
  mimeType: string;
  fileName: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
};

/**
 * Members tell the team what's wrong (or what they wish the app did), with
 * screenshots. Reports land in the team's Slack channel.
 */
export default function FeedbackScreen() {
  const { sessionToken, user } = useAuth();
  const params = useLocalSearchParams<{ coopId?: string; from?: string }>();
  const [category, setCategory] = React.useState<FeedbackCategory>('BUG');
  const [message, setMessage] = React.useState('');
  const [screenshots, setScreenshots] = React.useState<Screenshot[]>([]);
  const [status, setStatus] = React.useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = React.useState('');

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)' as any);
  };

  const pickScreenshots = async () => {
    setError('');
    const remaining = MAX_SCREENSHOTS - screenshots.length;
    if (remaining <= 0) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Allow photo library access to attach screenshots.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
    });
    if (result.canceled) return;

    const picked: Screenshot[] = [];
    for (const asset of result.assets.slice(0, remaining)) {
      if (asset.fileSize && asset.fileSize > MAX_SCREENSHOT_BYTES) {
        setError('Each screenshot must be under 10MB.');
        continue;
      }
      picked.push({
        uri: asset.uri,
        mimeType: asset.mimeType || 'image/jpeg',
        fileName: asset.fileName || null,
        width: asset.width || null,
        height: asset.height || null,
        sizeBytes: asset.fileSize || null,
      });
    }
    setScreenshots((current) => [...current, ...picked].slice(0, MAX_SCREENSHOTS));
  };

  const send = async () => {
    const trimmed = message.trim();
    if (status === 'sending') return;
    if (!trimmed) {
      setError('Tell us what happened.');
      return;
    }
    if (!sessionToken || !user) {
      setError('Sign in to send feedback.');
      return;
    }

    setStatus('sending');
    setError('');
    try {
      const uploaded = await Promise.all(
        screenshots.map((shot) =>
          api.uploadCommonsPostMedia({
            coopId: user.id,
            uploadType: 'feedback',
            uri: shot.uri,
            fileName: shot.fileName,
            mimeType: shot.mimeType,
            mediaType: 'image',
            width: shot.width,
            height: shot.height,
            sizeBytes: shot.sizeBytes,
          }),
        ),
      );
      await api.submitFeedback(
        {
          category,
          message: trimmed,
          screenshotUrls: uploaded.map((shot) => shot.url),
          screen: params.from || undefined,
          coopId: params.coopId || undefined,
          platform: Platform.OS,
          appVersion: Constants.expoConfig?.version || undefined,
        },
        sessionToken,
      );
      setStatus('sent');
    } catch (sendError) {
      console.error('Failed to send feedback:', sendError);
      setStatus('idle');
      setError(friendlyError(sendError, "We couldn't send your feedback."));
    }
  };

  const sending = status === 'sending';

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: THEME.paper }}>
      <View
        className="flex-row items-center gap-3 border-b bg-white px-4 pb-3 pt-3"
        style={{ borderColor: THEME.border }}
      >
        <TouchableOpacity
          onPress={handleBack}
          className="h-10 w-10 items-center justify-center rounded-full border bg-white"
          style={{ borderColor: THEME.border }}
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={18} color="#111827" />
        </TouchableOpacity>
        <Text className="flex-1 text-lg font-black text-gray-950">Report a problem</Text>
      </View>

      {status === 'sent' ? (
        <View className="flex-1 items-center justify-center px-8">
          <View
            className="h-14 w-14 items-center justify-center rounded-full"
            style={{ backgroundColor: THEME.primarySoft }}
          >
            <Check size={26} color={THEME.primary} />
          </View>
          <Text className="mt-4 text-center text-xl font-black text-gray-950">
            Thanks, the team has it
          </Text>
          <Text className="mt-2 text-center text-sm leading-5 text-gray-500">
            Your report and screenshots went straight to the people who build
            the app.
          </Text>
          <TouchableOpacity
            onPress={handleBack}
            className="mt-6 rounded-2xl px-8 py-3"
            style={{ backgroundColor: THEME.primary }}
            accessibilityRole="button"
          >
            <Text className="text-sm font-black text-white">Done</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          >
            <Text className="text-sm font-black text-gray-950">What kind of feedback?</Text>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {CATEGORIES.map((option) => {
                const selected = option.value === category;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => setCategory(option.value)}
                    className="rounded-full border px-3.5 py-2"
                    style={{
                      borderColor: selected ? THEME.primary : THEME.border,
                      backgroundColor: selected ? THEME.primarySoft : '#FFFFFF',
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <Text
                      className="text-xs font-black"
                      style={{ color: selected ? THEME.primary : '#475569' }}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text className="mt-6 text-sm font-black text-gray-950">What happened?</Text>
            <TextInput
              value={message}
              onChangeText={(text) => {
                setMessage(text);
                if (error) setError('');
              }}
              placeholder="Tell us what you were doing and what went wrong."
              placeholderTextColor={THEME.muted}
              maxLength={5000}
              multiline
              accessibilityLabel="What happened?"
              className="mt-3 min-h-32 rounded-2xl border bg-white px-3 py-3 text-sm text-gray-900"
              style={{ borderColor: THEME.border, textAlignVertical: 'top' }}
            />

            <Text className="mt-6 text-sm font-black text-gray-950">Screenshots</Text>
            <Text className="mt-1 text-xs leading-5 text-gray-500">
              Optional. Add up to {MAX_SCREENSHOTS} so we can see what you saw.
            </Text>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {screenshots.map((shot, index) => (
                <View
                  key={`${shot.uri}-${index}`}
                  className="overflow-hidden rounded-xl border border-gray-100 bg-white"
                  style={{ width: COMPOSER_MEDIA_TILE_SIZE, height: COMPOSER_MEDIA_TILE_SIZE }}
                >
                  <CommonsMediaTile
                    media={{ uri: shot.uri, mediaType: 'image', mimeType: shot.mimeType }}
                    size={COMPOSER_MEDIA_TILE_SIZE}
                  />
                  <TouchableOpacity
                    onPress={() =>
                      setScreenshots((current) => current.filter((_, i) => i !== index))
                    }
                    disabled={sending}
                    className="absolute right-1 top-1 h-7 w-7 items-center justify-center rounded-full bg-white/95"
                    accessibilityLabel="Remove screenshot"
                  >
                    <Trash2 size={13} color={THEME.danger} />
                  </TouchableOpacity>
                </View>
              ))}
              {screenshots.length < MAX_SCREENSHOTS ? (
                <TouchableOpacity
                  onPress={() => void pickScreenshots()}
                  disabled={sending}
                  className="items-center justify-center rounded-xl border border-dashed bg-white"
                  style={{
                    width: COMPOSER_MEDIA_TILE_SIZE,
                    height: COMPOSER_MEDIA_TILE_SIZE,
                    borderColor: THEME.border,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Add screenshots"
                >
                  <ImagePlus size={20} color={THEME.muted} />
                  <Text className="mt-1 text-[11px] font-bold text-gray-500">Add</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {error ? (
              <Text className="mt-4 text-sm font-semibold" style={{ color: THEME.danger }}>
                {error}
              </Text>
            ) : null}

            <TouchableOpacity
              onPress={() => void send()}
              disabled={sending}
              className="mt-6 flex-row items-center justify-center gap-2 rounded-2xl py-4"
              style={{ backgroundColor: THEME.primary, opacity: sending ? 0.6 : 1 }}
              accessibilityRole="button"
              accessibilityLabel="Send feedback"
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Send size={16} color="#FFFFFF" />
              )}
              <Text className="text-sm font-black text-white">
                {sending ? 'Sending…' : 'Send to the team'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
