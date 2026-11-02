import { DESIGN } from '@/constants/design';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';

import { EventDateField } from '@/components/event-date-field';
import { Text } from '@/components/ui/text';
import { useAuth } from '@/contexts/auth-context';
import { api, type EventRecurrenceFreq, type PrivateGroupSummary } from '@/lib/api';
import { friendlyError } from '@/lib/friendly-error';
import { keyboardScrollProps } from '@/lib/keyboard';

const THEME = DESIGN;

const RECURRENCE_OPTIONS: { label: string; value: EventRecurrenceFreq | null }[] = [
  { label: 'Does not repeat', value: null },
  { label: 'Daily', value: 'DAILY' },
  { label: 'Weekly', value: 'WEEKLY' },
  { label: 'Monthly', value: 'MONTHLY' },
];

function defaultStartAt() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  return date;
}

export default function CreateEventScreen() {
  const params = useLocalSearchParams<{ coopId?: string; circleId?: string }>();
  const coopId = params.coopId || 'cahootz';
  const { sessionToken } = useAuth();

  const [circles, setCircles] = useState<PrivateGroupSummary[]>([]);
  const [circleId, setCircleId] = useState(params.circleId || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState<Date>(defaultStartAt);
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [isOnline, setIsOnline] = useState(true);
  const [location, setLocation] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [allowComments, setAllowComments] = useState(true);
  const [recurrenceFreq, setRecurrenceFreq] = useState<EventRecurrenceFreq | null>(null);
  const [recurrenceInterval, setRecurrenceInterval] = useState('1');
  const [recurrenceCount, setRecurrenceCount] = useState('4');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionToken) return;
    api
      .listVisibleCircles(sessionToken, coopId)
      .then((result) => setCircles(result.groups || []))
      .catch((err) => console.error('Failed to load circles:', err));
  }, [coopId, sessionToken]);

  const publishEvent = async () => {
    if (isSubmitting || !sessionToken) return;
    if (!title.trim()) {
      setError('Give this event a name.');
      return;
    }
    const duration = Number(durationMinutes);
    if (!Number.isFinite(duration) || duration <= 0) {
      setError('Enter a valid duration in minutes.');
      return;
    }
    const endAt = new Date(startAt.getTime() + duration * 60000);

    let recurrence: { freq: EventRecurrenceFreq; interval: number; count: number } | undefined;
    if (recurrenceFreq) {
      const interval = Number(recurrenceInterval);
      const count = Number(recurrenceCount);
      if (!Number.isFinite(interval) || interval < 1) {
        setError('Enter a valid repeat interval.');
        return;
      }
      if (!Number.isFinite(count) || count < 2 || count > 24) {
        setError('Repeat count must be between 2 and 24.');
        return;
      }
      recurrence = { freq: recurrenceFreq, interval, count };
    }

    setIsSubmitting(true);
    setError('');
    try {
      const result = await api.createEvent(
        {
          coopId,
          circleId: circleId || undefined,
          title: title.trim(),
          description: description.trim(),
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          isOnline,
          location: isOnline ? undefined : location.trim() || undefined,
          meetingUrl: isOnline ? meetingUrl.trim() || undefined : undefined,
          allowComments,
          recurrence,
        },
        sessionToken,
      );
      router.replace({
        pathname: '/[coopId]/events/[eventId]',
        params: { coopId, eventId: result.event.id },
      } as any);
    } catch (err) {
      console.error('Failed to create event:', err);
      setError(friendlyError(err, "We couldn't create your event."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: THEME.paper }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="border-b border-gray-200 bg-white px-4 pt-14 pb-3">
        <View className="flex-row items-center gap-3">
          <TouchableOpacity
            onPress={() => router.canGoBack() ? router.back() : router.replace({ pathname: '/(tabs)/board', params: { coopId } })}
            className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color={THEME.ink} />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-950">Create event</Text>
        </View>
      </View>

      <ScrollView {...keyboardScrollProps} className="flex-1" contentContainerStyle={{ padding: DESIGN.gutter, gap: 24, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
        <View>
          <Text className="mb-1 text-sm font-semibold text-gray-700">Event name</Text>
          <TextInput
            accessibilityLabel="Event name"
            value={title}
            onChangeText={setTitle}
            placeholder="New member welcome"
            placeholderTextColor={THEME.muted}
            className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
          />
        </View>

        {circles.length > 0 ? (
          <View>
            <Text className="mb-1 text-sm font-semibold text-gray-700">Post in</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {circles.map((circle) => (
                  <TouchableOpacity
                    key={circle.id}
                    onPress={() => setCircleId(circle.id)}
                    className="min-h-12 justify-center rounded-xl border px-3 py-2"
                    style={{
                      borderColor: circleId === circle.id ? THEME.primary : THEME.border,
                      backgroundColor: circleId === circle.id ? DESIGN.primarySoft : DESIGN.paper,
                    }}
                  >
                    <Text
                      className="text-xs font-bold"
                      style={{ color: circleId === circle.id ? DESIGN.actionText : DESIGN.ink }}
                    >
                      {circle.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        <View className="flex-row gap-3">
          <View className="flex-1">
            <EventDateField
              label="Date"
              mode="date"
              value={startAt}
              minimumDate={new Date()}
              onChange={setStartAt}
            />
          </View>
          <View className="flex-1">
            <EventDateField label="Start time" mode="time" value={startAt} onChange={setStartAt} />
          </View>
        </View>

        <View>
          <Text className="mb-1 text-sm font-semibold text-gray-700">Duration (minutes)</Text>
          <TextInput
            accessibilityLabel="Duration (minutes)"
            value={durationMinutes}
            onChangeText={setDurationMinutes}
            keyboardType="number-pad"
            placeholderTextColor={THEME.muted}
            className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
          />
        </View>

        <View>
          <Text className="mb-1 text-sm font-semibold text-gray-700">Repeats</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2">
              {RECURRENCE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: recurrenceFreq === option.value }}
                  onPress={() => setRecurrenceFreq(option.value)}
                  className="min-h-12 justify-center rounded-xl border px-3 py-2"
                  style={{
                    borderColor: recurrenceFreq === option.value ? THEME.primary : THEME.border,
                    backgroundColor: recurrenceFreq === option.value ? DESIGN.primarySoft : DESIGN.paper,
                  }}
                >
                  <Text
                    className="text-xs font-bold"
                    style={{ color: recurrenceFreq === option.value ? DESIGN.actionText : DESIGN.ink }}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {recurrenceFreq ? (
            <View className="mt-2 flex-row flex-wrap items-center gap-2">
              <Text className="text-xs font-semibold text-gray-600">Every</Text>
              <TextInput
                value={recurrenceInterval}
                onChangeText={setRecurrenceInterval}
                keyboardType="number-pad"
                accessibilityLabel="Repeat interval"
                className="w-14 rounded-xl border border-gray-200 bg-white px-3 py-2 text-center text-base text-gray-900"
              />
              <Text className="text-xs font-semibold text-gray-600">
                {recurrenceFreq === 'DAILY' ? 'day(s), for' : recurrenceFreq === 'WEEKLY' ? 'week(s), for' : 'month(s), for'}
              </Text>
              <TextInput
                value={recurrenceCount}
                onChangeText={setRecurrenceCount}
                keyboardType="number-pad"
                accessibilityLabel="Number of occurrences"
                className="w-14 rounded-xl border border-gray-200 bg-white px-3 py-2 text-center text-base text-gray-900"
              />
              <Text className="text-xs font-semibold text-gray-600">times</Text>
            </View>
          ) : null}
        </View>

        <View>
          <Text className="mb-1 text-sm font-semibold text-gray-700">Location</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setIsOnline(true)}
              className="flex-1 items-center min-h-12 justify-center rounded-xl border px-3 py-2.5"
              style={{
                borderColor: isOnline ? THEME.primary : THEME.border,
                backgroundColor: isOnline ? DESIGN.primarySoft : DESIGN.paper,
              }}
            >
              <Text
                className="text-xs font-bold"
                style={{ color: isOnline ? DESIGN.actionText : DESIGN.ink }}
              >
                Online
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setIsOnline(false)}
              className="flex-1 items-center min-h-12 justify-center rounded-xl border px-3 py-2.5"
              style={{
                borderColor: !isOnline ? THEME.primary : THEME.border,
                backgroundColor: !isOnline ? DESIGN.primarySoft : DESIGN.paper,
              }}
            >
              <Text
                className="text-xs font-bold"
                style={{ color: !isOnline ? DESIGN.actionText : DESIGN.ink }}
              >
                In person
              </Text>
            </TouchableOpacity>
          </View>
          {isOnline ? (
            <TextInput
              accessibilityLabel="Meeting link"
            value={meetingUrl}
              onChangeText={setMeetingUrl}
              placeholder="Google Meet link (optional)"
              placeholderTextColor={THEME.muted}
              autoCapitalize="none"
              className="mt-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
            />
          ) : (
            <TextInput
              accessibilityLabel="Address"
            value={location}
              onChangeText={setLocation}
              placeholder="Address"
              placeholderTextColor={THEME.muted}
              className="mt-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
            />
          )}
        </View>

        <View>
          <Text className="mb-1 text-sm font-semibold text-gray-700">Description</Text>
          <TextInput
            accessibilityLabel="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="Meet your table and ask questions."
            placeholderTextColor={THEME.muted}
            multiline
            className="min-h-24 rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
            style={{ textAlignVertical: 'top' }}
          />
        </View>

        <View className="flex-row items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
          <View className="min-w-0 flex-1 pr-3">
            <Text className="text-sm font-bold text-gray-950">Allow comments</Text>
            <Text className="text-xs text-gray-500">Members of this circle will see the event as a post.</Text>
          </View>
          <Switch accessibilityLabel="Allow comments" value={allowComments} onValueChange={setAllowComments} />
        </View>

        {error ? <Text className="text-sm font-semibold text-red-600">{error}</Text> : null}

        <TouchableOpacity
          onPress={publishEvent}
          disabled={isSubmitting}
          className="min-h-12 items-center justify-center rounded-xl px-4 py-3.5"
          style={{ backgroundColor: THEME.primary, opacity: isSubmitting ? 0.7 : 1 }}
          accessibilityRole="button"
          accessibilityLabel="Publish event"
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text className="text-sm font-bold" style={{ color: DESIGN.ink }}>Publish event</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
