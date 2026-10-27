import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Send } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { SageAvatar } from '@/components/sage-avatar';
import { LoadError } from '@/components/load-error';
import { useAuth } from '@/contexts/auth-context';
import { api, type SageChat, type SageChatMessage } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { keyboardAvoidingBehavior, keyboardScrollProps } from '@/lib/keyboard';

const THEME = {
  paper: '#F8FAFC',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  border: '#E5E7EB',
  muted: '#64748B',
  ink: '#111827',
};

const STARTERS = [
  "What's going on in our Commons this week?",
  'Who needs help right now?',
  'How do proposals and votes work here?',
];

function resetDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function allowanceLine(chat: SageChat) {
  const { freeLeft, freeLimit, paidLeft } = chat.allowance;
  const free = `${freeLeft} of ${freeLimit} free this month`;
  return paidLeft > 0 ? `${free} · ${paidLeft} bought` : free;
}

export default function AskSageScreen() {
  const params = useLocalSearchParams<{ coopId?: string }>();
  const coopId = params.coopId || 'cahootz';
  const { isLoading, isAuthenticated, sessionToken } = useAuth();
  const [chat, setChat] = useState<SageChat | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (isLoading || (isAuthenticated && sessionToken)) return;
    router.replace({ pathname: '/', params: { entry: 'sign-in' } } as any);
  }, [isAuthenticated, isLoading, sessionToken]);

  const load = useCallback(() => {
    if (!sessionToken) return;
    setLoadError(null);
    api.getSageChat(coopId, sessionToken)
      .then(setChat)
      .catch((error) => setLoadError(friendlyError(error, "We couldn't open your chat with Sage.")));
  }, [coopId, sessionToken]);

  // Reload on focus, so messages bought in the store show up when the member comes back.
  useFocusEffect(load);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [chat?.messages.length, pending]);

  const send = async (text = draft) => {
    const content = text.trim();
    if (!content || !sessionToken || !chat || pending) return;
    setPending(content);
    setDraft('');
    setSendError(null);
    try {
      const result = await api.sendSageChat(coopId, content, sessionToken);
      setChat((current) => current && {
        ...current,
        messages: [...current.messages, ...result.sent] as SageChatMessage[],
        allowance: result.allowance,
        storeReady: result.storeReady,
        packs: result.packs,
      });
      // Out of messages: nothing was sent, so the text goes back in the box.
      if (result.status === 'OUT_OF_MESSAGES') setDraft(content);
    } catch (error) {
      setDraft(content);
      setSendError(friendlyError(error, "Your message didn't send. Please try again."));
    } finally {
      setPending(null);
    }
  };

  const outOfMessages = chat ? chat.allowance.left <= 0 : false;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: THEME.paper }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={keyboardAvoidingBehavior}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: THEME.border, backgroundColor: '#FFFFFF' }}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/[coopId]/posts', params: { coopId } } as any))}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={{ height: 40, width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: THEME.primarySoft }}
          >
            <ArrowLeft size={20} color={THEME.primary} />
          </TouchableOpacity>
          <SageAvatar size={36} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: THEME.ink }}>Ask Sage</Text>
            <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '600', color: THEME.muted }}>
              {chat ? `About ${chat.commonsName} · only you can see this` : 'Only you can see this chat'}
            </Text>
          </View>
        </View>

        {chat ? (
          <View testID="sage-allowance" style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderColor: THEME.border }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: THEME.ink }}>
              {chat.allowance.left === 1 ? '1 message left' : `${chat.allowance.left} messages left`}
            </Text>
            <Text style={{ fontSize: 12, color: THEME.muted }}>{allowanceLine(chat)}</Text>
          </View>
        ) : null}

        <ScrollView ref={scrollRef} {...keyboardScrollProps} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
          {loadError ? <LoadError message={loadError} onRetry={load} /> : null}
          {!chat && !loadError ? <ActivityIndicator color={THEME.primary} style={{ marginTop: 32 }} /> : null}

          {chat && chat.messages.length === 0 && !pending ? (
            <View style={{ borderRadius: 14, padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: THEME.border, gap: 10 }}>
              <Text style={{ fontSize: 15, lineHeight: 21, color: THEME.ink }}>
                Hi! Ask me anything about {chat.commonsName}: what's going on, who could use a hand, or how votes work here.
              </Text>
              <Text style={{ fontSize: 13, lineHeight: 19, color: THEME.muted }}>
                You get {chat.allowance.freeLimit} free messages each month. Your Sage DMs use the same ones.
              </Text>
              {!outOfMessages ? STARTERS.map((starter) => (
                <TouchableOpacity
                  key={starter}
                  onPress={() => void send(starter)}
                  accessibilityRole="button"
                  style={{ borderRadius: 12, borderWidth: 1, borderColor: THEME.border, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: THEME.primarySoft }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: THEME.ink }}>{starter}</Text>
                </TouchableOpacity>
              )) : null}
            </View>
          ) : null}

          {chat?.messages.map((message) => (
            <View
              key={message.id}
              testID={message.fromSage ? 'sage-chat-reply' : 'sage-chat-question'}
              style={{
                maxWidth: '86%', alignSelf: message.fromSage ? 'flex-start' : 'flex-end', borderRadius: 14,
                paddingHorizontal: 14, paddingVertical: 10, backgroundColor: message.fromSage ? '#FFFFFF' : THEME.primary,
                borderWidth: message.fromSage ? 1 : 0, borderColor: THEME.border,
              }}
            >
              <Text style={{ fontSize: 14, lineHeight: 20, color: message.fromSage ? THEME.ink : '#FFFFFF' }}>{message.body}</Text>
            </View>
          ))}

          {pending ? (
            <>
              <View style={{ maxWidth: '86%', alignSelf: 'flex-end', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: THEME.primary, opacity: 0.7 }}>
                <Text style={{ fontSize: 14, lineHeight: 20, color: '#FFFFFF' }}>{pending}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
                <SageAvatar size={28} motion="thinking" />
                <Text style={{ fontSize: 13, color: THEME.muted }}>Sage is thinking…</Text>
              </View>
            </>
          ) : null}

          {sendError ? (
            <Text accessibilityRole="alert" style={{ fontSize: 13, color: '#B91C1C' }}>{sendError}</Text>
          ) : null}
        </ScrollView>

        {chat && outOfMessages ? (
          <View testID="sage-out-of-messages" style={{ padding: 16, gap: 10, borderTopWidth: 1, borderColor: THEME.border, backgroundColor: '#FFFFFF' }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: THEME.ink }}>You're out of Sage messages for now</Text>
            <Text style={{ fontSize: 13, lineHeight: 19, color: THEME.muted }}>
              Your {chat.allowance.freeLimit} free messages come back on {resetDate(chat.allowance.resetsAt)}.
              {chat.storeReady && chat.packs.length ? ' Want to keep going? Get more from your Commons store. Bought messages never expire.' : ''}
            </Text>
            {chat.storeReady ? chat.packs.map((pack) => (
              <TouchableOpacity
                key={pack.productId}
                onPress={() => router.push({ pathname: '/(authenticated)/product-detail', params: { id: pack.productId } } as any)}
                accessibilityRole="button"
                accessibilityLabel={`Get ${pack.messages} messages for $${pack.priceUSD}`}
                style={{ borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: THEME.primary }}
              >
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#FFFFFF' }}>
                  Get {pack.messages} messages · ${pack.priceUSD}
                </Text>
              </TouchableOpacity>
            )) : (
              <Text style={{ fontSize: 13, color: THEME.muted }}>
                Your Commons store isn't set up to sell more messages yet.
              </Text>
            )}
          </View>
        ) : chat ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderColor: THEME.border, backgroundColor: '#FFFFFF' }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={`Ask Sage about ${chat.commonsName}`}
              accessibilityLabel="Message Sage"
              placeholderTextColor="#78716C"
              multiline
              maxLength={1500}
              style={{ flex: 1, minHeight: 44, maxHeight: 110, borderRadius: 12, borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.paper, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: THEME.ink, textAlignVertical: 'top' }}
            />
            <TouchableOpacity
              onPress={() => void send()}
              disabled={Boolean(pending) || !draft.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send"
              style={{ height: 44, width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: THEME.primary, opacity: pending || !draft.trim() ? 0.5 : 1 }}
            >
              {pending ? <ActivityIndicator size="small" color="white" /> : <Send size={18} color="white" />}
            </TouchableOpacity>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
