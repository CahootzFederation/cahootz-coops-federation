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

const THEME = {
  paper: '#F6F7F8',
  primary: '#FF6B00',
  ink: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
};

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
      setError(err instanceof Error ? err.message : 'Could not create the event.');
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
            onPress={() => router.back()}
            className="h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={22} color={THEME.ink} />
          </TouchableOpacity>
          <Text className="text-xl font-black text-gray-950">Create event</Text>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View>
          <Text className="mb-1 text-xs font-black uppercase text-gray-500">Event name</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="New member welcome"
            placeholderTextColor={THEME.muted}
            className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
          />
        </View>

        {circles.length > 0 ? (
          <View>
            <Text className="mb-1 text-xs font-black uppercase text-gray-500">Post in</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {circles.map((circle) => (
                  <TouchableOpacity
                    key={circle.id}
                    onPress={() => setCircleId(circle.id)}
                    className="rounded-full border px-3 py-2"
                    style={{
                      borderColor: circleId === circle.id ? THEME.primary : THEME.border,
                      backgroundColor: circleId === circle.id ? '#FFF7ED' : 'white',
                    }}
                  >
                    <Text
                      className="text-xs font-black"
                      style={{ color: circleId === circle.id ? THEME.primary : '#374151' }}
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
          <Text className="mb-1 text-xs font-black uppercase text-gray-500">Duration (minutes)</Text>
          <TextInput
            value={durationMinutes}
            onChangeText={setDurationMinutes}
            keyboardType="number-pad"
            placeholderTextColor={THEME.muted}
            className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
          />
        </View>

        <View>
          <Text className="mb-1 text-xs font-black uppercase text-gray-500">Repeats</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2">
              {RECURRENCE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.label}
                  onPress={() => setRecurrenceFreq(option.value)}
                  className="rounded-full border px-3 py-2"
                  style={{
                    borderColor: recurrenceFreq === option.value ? THEME.primary : THEME.border,
                    backgroundColor: recurrenceFreq === option.value ? '#FFF7ED' : 'white',
                  }}
                >
                  <Text
                    className="text-xs font-black"
                    style={{ color: recurrenceFreq === option.value ? THEME.primary : '#374151' }}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {recurrenceFreq ? (
            <View className="mt-2 flex-row items-center gap-2">
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
          <Text className="mb-1 text-xs font-black uppercase text-gray-500">Location</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={() => setIsOnline(true)}
              className="flex-1 items-center rounded-xl border px-3 py-2.5"
              style={{
                borderColor: isOnline ? THEME.primary : THEME.border,
                backgroundColor: isOnline ? '#FFF7ED' : 'white',
              }}
            >
              <Text
                className="text-xs font-black"
                style={{ color: isOnline ? THEME.primary : '#374151' }}
              >
                Online
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setIsOnline(false)}
              className="flex-1 items-center rounded-xl border px-3 py-2.5"
              style={{
                borderColor: !isOnline ? THEME.primary : THEME.border,
                backgroundColor: !isOnline ? '#FFF7ED' : 'white',
              }}
            >
              <Text
                className="text-xs font-black"
                style={{ color: !isOnline ? THEME.primary : '#374151' }}
              >
                In person
              </Text>
            </TouchableOpacity>
          </View>
          {isOnline ? (
            <TextInput
              value={meetingUrl}
              onChangeText={setMeetingUrl}
              placeholder="Google Meet link (optional)"
              placeholderTextColor={THEME.muted}
              autoCapitalize="none"
              className="mt-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
            />
          ) : (
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Address"
              placeholderTextColor={THEME.muted}
              className="mt-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900"
            />
          )}
        </View>

        <View>
          <Text className="mb-1 text-xs font-black uppercase text-gray-500">Description</Text>
          <TextInput
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
            <Text className="text-sm font-black text-gray-950">Allow comments</Text>
            <Text className="text-xs text-gray-500">Members of this circle will see the event as a post.</Text>
          </View>
          <Switch value={allowComments} onValueChange={setAllowComments} />
        </View>

        {error ? <Text className="text-sm font-semibold text-red-600">{error}</Text> : null}

        <TouchableOpacity
          onPress={publishEvent}
          disabled={isSubmitting}
          className="items-center rounded-full px-4 py-3.5"
          style={{ backgroundColor: THEME.primary, opacity: isSubmitting ? 0.7 : 1 }}
          accessibilityLabel="Publish event"
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text className="text-sm font-black text-white">Publish event</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
