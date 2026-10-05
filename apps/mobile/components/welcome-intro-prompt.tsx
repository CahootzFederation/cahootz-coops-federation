import { useEffect, useState } from 'react';
import { ActivityIndicator, TextInput, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { Hand } from 'lucide-react-native';

import { PushPermissionPrimer } from '@/components/push-permission-primer';
import { Text } from '@/components/ui/text';
import { api, type WelcomeIntroStatus } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { canOfferPushPrimer } from '@/lib/push-primer';
import { secureStorage } from '@/lib/secure-storage';

const PRIMARY = '#FF6B00';
const INTRO_MAX_LENGTH = 280;

// Per device and lounge: "Skip" hides the prompt here without affecting the
// account (the newcomer can still introduce themselves in the thread).
const skippedKey = (groupId: string) => `cahootz.welcomeIntroSkipped.${groupId}`;

type Stage = 'loading' | 'hidden' | 'prompt' | 'posted';

/**
 * Welcome lounge feed card that asks a newcomer for a one-line intro. The
 * intro is posted as a comment on the lounge's Sage welcome thread - the
 * same place Sage asks people to introduce themselves - so the server can
 * alert them when someone replies. Right after posting, it offers the push
 * notification primer.
 */
export function WelcomeIntroPrompt({
  groupId,
  coopId,
  sessionToken,
}: {
  groupId: string;
  coopId: string;
  sessionToken: string;
}) {
  const [stage, setStage] = useState<Stage>('loading');
  const [status, setStatus] = useState<WelcomeIntroStatus | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [introCommentId, setIntroCommentId] = useState<string | null>(null);
  const [showPrimer, setShowPrimer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStage('loading');
    Promise.all([
      api.getWelcomeIntroStatus(groupId, sessionToken),
      secureStorage.getItem(skippedKey(groupId)),
    ])
      .then(([result, skipped]) => {
        if (cancelled) return;
        setStatus(result);
        setStage(result.eligible && result.welcomePostId && !skipped ? 'prompt' : 'hidden');
      })
      .catch((caughtError) => {
        // Not being able to prompt must never block the feed.
        console.warn('Could not load welcome intro status', caughtError);
        if (!cancelled) setStage('hidden');
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, sessionToken]);

  const postIntro = async () => {
    const content = draft.trim();
    if (!content || isPosting || !status?.welcomePostId) return;
    setIsPosting(true);
    setError('');
    try {
      const result = await api.createCommonsComment({ postId: status.welcomePostId, content }, sessionToken);
      setIntroCommentId(result.comment.id);
      setStage('posted');
      setShowPrimer(await canOfferPushPrimer());
    } catch (caughtError) {
      console.error('Failed to post welcome intro:', caughtError);
      setError(friendlyError(caughtError, "We couldn't post your intro."));
    } finally {
      setIsPosting(false);
    }
  };

  const skip = async () => {
    setStage('hidden');
    try {
      await secureStorage.setItem(skippedKey(groupId), '1');
    } catch (caughtError) {
      console.warn('Could not remember skipped intro prompt', caughtError);
    }
  };

  const openIntro = () => {
    if (!status?.welcomePostId) return;
    router.push({
      pathname: '/[coopId]/posts/[postId]',
      params: { coopId, postId: status.welcomePostId, ...(introCommentId ? { commentId: introCommentId } : {}) },
    } as any);
  };

  if (stage === 'loading' || stage === 'hidden' || !status) return null;

  if (stage === 'posted') {
    return (
      <View>
        <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4" accessibilityLiveRegion="polite">
          <Text className="text-sm font-black text-gray-950">Your intro is posted 🎉</Text>
          <Text className="mt-1 text-xs leading-5 text-gray-700">
            It&apos;s on the lounge&apos;s welcome thread, where people say hi to each other.
          </Text>
          <TouchableOpacity accessibilityRole="button" onPress={openIntro} className="mt-3 self-start">
            <Text className="text-xs font-black" style={{ color: PRIMARY }}>View your intro</Text>
          </TouchableOpacity>
        </View>
        {showPrimer ? (
          <PushPermissionPrimer sessionToken={sessionToken} coopId={coopId} onDone={() => setShowPrimer(false)} />
        ) : null}
      </View>
    );
  }

  return (
    <View
      className="mb-4 rounded-2xl border p-4"
      style={{ backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }}
      accessibilityLabel="Introduce yourself"
    >
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-white">
          <Hand size={18} color={PRIMARY} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-black text-gray-950">{status.prompt}</Text>
          <Text className="mt-1 text-xs leading-5 text-gray-700">
            One line is plenty. It goes on the lounge&apos;s welcome thread so people can say hi back.
          </Text>
        </View>
      </View>
      <TextInput
        value={draft}
        onChangeText={(text) => {
          setDraft(text.slice(0, INTRO_MAX_LENGTH));
          if (error) setError('');
        }}
        placeholder="I'm here because..."
        placeholderTextColor="#9CA3AF"
        accessibilityLabel="Your intro"
        maxLength={INTRO_MAX_LENGTH}
        className="mt-3 rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm text-gray-900"
        returnKeyType="send"
        onSubmitEditing={() => void postIntro()}
      />
      {error ? <Text className="mt-2 text-xs font-semibold text-red-700">{error}</Text> : null}
      <View className="mt-3 flex-row items-center gap-2">
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => void postIntro()}
          disabled={isPosting || !draft.trim()}
          className="flex-row items-center gap-1.5 rounded-full px-4 py-2"
          style={{ backgroundColor: PRIMARY, opacity: isPosting || !draft.trim() ? 0.5 : 1 }}
        >
          {isPosting ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
          <Text className="text-xs font-black text-white">Post intro</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={() => void skip()} className="rounded-full px-4 py-2">
          <Text className="text-xs font-black text-gray-600">Skip</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
