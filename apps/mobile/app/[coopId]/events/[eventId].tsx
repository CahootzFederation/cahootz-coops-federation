import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Bell, BellOff, Calendar, MapPin, Repeat, Send, Users, Video } from 'lucide-react-native';

import { MentionComposerInput } from '@/components/mention-composer-input';
import { MentionText } from '@/components/mention-text';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type EventDetail, type EventRsvpStatus } from '@/lib/api';

const THEME = {
  paper: '#F6F7F8',
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  ink: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
};

function formatFullDateTime(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const dateLabel = start.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const timeLabel = `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  return { dateLabel, timeLabel };
}

function recurrenceLabel(freq: 'DAILY' | 'WEEKLY' | 'MONTHLY', interval: number) {
  if (interval <= 1) {
    return freq === 'DAILY' ? 'Repeats daily' : freq === 'WEEKLY' ? 'Repeats weekly' : 'Repeats monthly';
  }
  const unit = freq === 'DAILY' ? 'days' : freq === 'WEEKLY' ? 'weeks' : 'months';
  return `Repeats every ${interval} ${unit}`;
}

function minutesUntil(startIso: string) {
  return Math.round((new Date(startIso).getTime() - Date.now()) / 60000);
}

function googleCalendarUrl(event: EventDetail) {
  const format = (iso: string) => iso.replace(/[-:]/g, '').split('.')[0] + 'Z';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.post.title,
    dates: `${format(event.startAt)}/${format(event.endAt)}`,
    details: event.post.body,
    location: event.isOnline ? event.meetingUrl || '' : event.location || '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export default function EventDetailScreen() {
  const params = useLocalSearchParams<{ coopId?: string; eventId?: string; reminder?: string }>();
  const coopId = params.coopId || 'cahootz';
  const eventId = params.eventId || '';
  const { sessionToken } = useAuth();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [rsvpPending, setRsvpPending] = useState(false);
  const [reminderMuted, setReminderMuted] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [isCommenting, setIsCommenting] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!eventId) {
      setError('Event not found.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    api
      .fetchEventDetail(eventId, sessionToken)
      .then((result) => {
        if (mounted) setEvent(result);
      })
      .catch((err) => {
        console.error('Failed to load event:', err);
        if (mounted) setError(err instanceof Error ? err.message : 'Could not load this event.');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [eventId, sessionToken]);

  const isReminderHandoff = params.reminder === '1';
  const startsInMinutes = event ? minutesUntil(event.startAt) : null;

  const rsvp = async (status: EventRsvpStatus) => {
    if (!event || rsvpPending) return;
    if (!sessionToken) {
      router.push({ pathname: '/', params: { entry: 'sign-in' } } as any);
      return;
    }
    setRsvpPending(true);
    try {
      const updated = await api.rsvpToEvent(event.id, status, sessionToken);
      setEvent((current) => (current ? { ...current, ...updated } : current));
    } catch (err) {
      Alert.alert('Could not RSVP', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setRsvpPending(false);
    }
  };

  const toggleReminder = async () => {
    if (!event || !sessionToken) return;
    const nextMuted = !reminderMuted;
    setReminderMuted(nextMuted);
    try {
      await api.muteEventReminder(event.id, nextMuted, sessionToken);
    } catch (err) {
      setReminderMuted(!nextMuted);
      Alert.alert('Could not update reminder', err instanceof Error ? err.message : 'Please try again.');
    }
  };

  const submitComment = async () => {
    const content = commentDraft.trim();
    if (!event || !content || isCommenting || !sessionToken) return;
    setIsCommenting(true);
    try {
      const result = await api.createCommonsComment({ postId: event.post.id, content, media: [] }, sessionToken);
      setEvent((current) =>
        current
          ? {
              ...current,
              post: {
                ...current.post,
                replies: current.post.replies + 1,
                comments: [...current.post.comments, result.comment],
              },
            }
          : current,
      );
      setCommentDraft('');
    } catch (err) {
      Alert.alert('Could not comment', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setIsCommenting(false);
    }
  };

  const { dateLabel, timeLabel } = useMemo(
    () => (event ? formatFullDateTime(event.startAt, event.endAt) : { dateLabel: '', timeLabel: '' }),
    [event],
  );

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: THEME.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="border-b border-gray-200 bg-white px-4 pt-14 pb-3">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            onPress={() => router.back()}
            className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color={THEME.ink} />
          </TouchableOpacity>
          <Text className="text-xl font-black text-gray-950">Event</Text>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 28, gap: 16 }} keyboardShouldPersistTaps="handled">
        {isLoading ? (
          <View className="mt-12 items-center gap-3">
            <ActivityIndicator color={THEME.primary} />
            <Text className="text-sm font-semibold text-gray-600">Loading event...</Text>
          </View>
        ) : null}

        {!isLoading && error && !event ? (
          <View className="rounded-xl border border-red-200 bg-red-50 p-4">
            <Text className="font-black text-red-700">Could not open event</Text>
            <Text className="mt-1 text-sm text-red-700">{error}</Text>
          </View>
        ) : null}

        {event ? (
          <>
            {isReminderHandoff && startsInMinutes !== null && startsInMinutes > 0 ? (
              <View className="items-center rounded-2xl border p-5" style={{ backgroundColor: THEME.primarySoft, borderColor: THEME.border }}>
                <Calendar size={28} color={THEME.primary} />
                <Text className="mt-2 text-base font-black text-gray-950">{event.post.title}</Text>
                <Text className="mt-1 text-sm font-bold" style={{ color: THEME.primary }}>
                  Starts in {startsInMinutes} minute{startsInMinutes === 1 ? '' : 's'}
                </Text>
                {event.isOnline && event.meetingUrl ? (
                  <TouchableOpacity
                    onPress={() => Linking.openURL(event.meetingUrl!)}
                    className="mt-4 w-full items-center rounded-full px-4 py-3"
                    style={{ backgroundColor: THEME.primary }}
                  >
                    <Text className="text-sm font-black text-white">Join Google Meet</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            <View className="rounded-2xl border bg-white p-4" style={{ borderColor: THEME.border }}>
              <Text className="text-2xl font-black text-gray-950">{event.post.title}</Text>
              <Text className="mt-2 text-sm font-bold text-gray-800">{dateLabel}</Text>
              <Text className="text-sm text-gray-600">{timeLabel}</Text>

              <View className="mt-2 flex-row items-center gap-1.5">
                {event.isOnline ? <Video size={14} color={THEME.muted} /> : <MapPin size={14} color={THEME.muted} />}
                <Text className="text-sm text-gray-600">
                  {event.isOnline ? event.meetingUrl || 'Online' : event.location || 'In person'}
                </Text>
              </View>

              {event.recurrenceFreq ? (
                <View className="mt-2 flex-row items-center gap-1.5">
                  <Repeat size={14} color={THEME.muted} />
                  <Text className="text-sm text-gray-600">
                    {recurrenceLabel(event.recurrenceFreq, event.recurrenceInterval ?? 1)}
                  </Text>
                </View>
              ) : null}

              {event.hosts.length > 0 ? (
                <View className="mt-2 flex-row items-center gap-1.5">
                  <Users size={14} color={THEME.muted} />
                  <Text className="text-sm text-gray-600">
                    Hosted by {event.hosts.map((host) => host.name).join(', ')}
                  </Text>
                </View>
              ) : null}

              {event.post.body ? (
                <MentionText
                  content={event.post.body}
                  className="mt-3"
                  style={{ fontSize: 14, lineHeight: 20, color: '#374151' }}
                />
              ) : null}

              <View className="mt-4 flex-row gap-2">
                {(
                  [
                    ['GOING', `Going (${event.goingCount})`],
                    ['MAYBE', `Maybe (${event.maybeCount})`],
                    ['CANT_GO', "Can't go"],
                  ] as [EventRsvpStatus, string][]
                ).map(([status, label]) => {
                  const active = event.viewerRsvpStatus === status;
                  return (
                    <TouchableOpacity
                      key={status}
                      onPress={() => rsvp(status)}
                      disabled={rsvpPending}
                      className="flex-1 items-center rounded-full border px-2 py-2.5"
                      style={{
                        borderColor: active ? THEME.primary : THEME.border,
                        backgroundColor: active ? THEME.primarySoft : 'white',
                        opacity: rsvpPending ? 0.6 : 1,
                      }}
                    >
                      <Text className="text-xs font-black" style={{ color: active ? THEME.primary : '#374151' }}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View className="mt-3 flex-row gap-2">
                <TouchableOpacity
                  onPress={() => Linking.openURL(googleCalendarUrl(event))}
                  className="flex-1 flex-row items-center justify-center gap-2 rounded-full border px-3 py-2.5"
                  style={{ borderColor: THEME.border }}
                >
                  <Calendar size={16} color={THEME.ink} />
                  <Text className="text-xs font-black text-gray-800">Add to calendar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={toggleReminder}
                  className="flex-row items-center justify-center gap-2 rounded-full border px-3 py-2.5"
                  style={{ borderColor: THEME.border }}
                  accessibilityLabel={reminderMuted ? 'Unmute reminders' : 'Mute reminders'}
                >
                  {reminderMuted ? (
                    <BellOff size={16} color={THEME.muted} />
                  ) : (
                    <Bell size={16} color={THEME.ink} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {error ? <Text className="text-sm font-semibold text-red-600">{error}</Text> : null}

            {event.allowComments ? (
              <View className="rounded-2xl border bg-white p-4" style={{ borderColor: THEME.border }}>
                <Text className="text-base font-black text-gray-950">Discussion · {event.post.comments.length}</Text>
                <View className="mt-3 gap-3">
                  {event.post.comments.length === 0 ? (
                    <Text className="text-sm text-gray-500">No comments yet.</Text>
                  ) : null}
                  {event.post.comments.map((comment) => (
                    <View key={comment.id} className="rounded-xl bg-stone-50 p-3">
                      <Text className="text-xs font-black text-stone-800">{comment.author}</Text>
                      {comment.body ? (
                        <MentionText
                          content={comment.body}
                          className="mt-1"
                          style={{ fontSize: 14, lineHeight: 20, color: '#44403C' }}
                        />
                      ) : null}
                    </View>
                  ))}
                </View>

                <View className="mt-3 flex-row items-end gap-2">
                  <MentionComposerInput
                    value={commentDraft}
                    onChangeText={setCommentDraft}
                    coopId={coopId}
                    placeholder="Write a comment..."
                    placeholderTextColor={THEME.muted}
                    multiline
                    className="min-h-11 flex-1 rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900"
                    style={{ maxHeight: 96, textAlignVertical: 'top', backgroundColor: THEME.paper }}
                  />
                  <TouchableOpacity
                    onPress={submitComment}
                    disabled={isCommenting || !commentDraft.trim()}
                    className="h-11 w-11 items-center justify-center rounded-xl"
                    style={{ backgroundColor: commentDraft.trim() ? THEME.primary : '#FDBA74' }}
                    accessibilityLabel="Send comment"
                  >
                    {isCommenting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Send size={17} color="#FFFFFF" />}
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
