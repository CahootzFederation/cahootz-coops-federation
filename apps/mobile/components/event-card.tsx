import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { Calendar, MapPin, Repeat, Users, Video } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import type { EventRsvpStatus, EventSummary } from '@/lib/api';

const THEME = {
  primary: '#FF6B00',
  primarySoft: '#FFF7ED',
  primaryBorder: '#FED7AA',
  border: '#E5E7EB',
};

function formatDateBadge(iso: string) {
  const date = new Date(iso);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
    day: date.getDate(),
  };
}

function formatTimeRange(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${fmt(start)} – ${fmt(end)}`;
}

function recurrenceLabel(freq: 'DAILY' | 'WEEKLY' | 'MONTHLY', interval: number) {
  if (interval <= 1) {
    return freq === 'DAILY' ? 'Repeats daily' : freq === 'WEEKLY' ? 'Repeats weekly' : 'Repeats monthly';
  }
  const unit = freq === 'DAILY' ? 'days' : freq === 'WEEKLY' ? 'weeks' : 'months';
  return `Repeats every ${interval} ${unit}`;
}

export function EventCard({
  event,
  title,
  compact = false,
  rsvpPending = false,
  onPress,
  onRsvp,
}: {
  event: EventSummary;
  title: string;
  compact?: boolean;
  rsvpPending?: boolean;
  onPress?: () => void;
  onRsvp?: (status: EventRsvpStatus) => void;
}) {
  const { weekday, day } = formatDateBadge(event.startAt);

  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.85 : 1}
      onPress={onPress}
      disabled={!onPress}
      className="rounded-[24px] border bg-white p-4"
      style={{ borderColor: THEME.border }}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Event: ${title}`}
    >
      <View className="flex-row gap-3">
        <View
          className="items-center justify-center rounded-2xl px-2.5 py-1.5"
          style={{ backgroundColor: THEME.primarySoft, borderWidth: 1, borderColor: THEME.primaryBorder, minWidth: 52 }}
        >
          <Text className="text-[10px] font-black" style={{ color: THEME.primary }}>
            {weekday}
          </Text>
          <Text className="text-lg font-black text-gray-950">{day}</Text>
        </View>

        <View className="min-w-0 flex-1">
          <Text
            className="text-base font-black text-gray-950"
            numberOfLines={compact ? 1 : 2}
          >
            {title}
          </Text>
          <Text className="mt-0.5 text-xs font-semibold text-gray-600">
            {formatTimeRange(event.startAt, event.endAt)}
          </Text>
          <View className="mt-1 flex-row items-center gap-1">
            {event.isOnline ? (
              <Video size={12} color="#6B7280" />
            ) : (
              <MapPin size={12} color="#6B7280" />
            )}
            <Text className="text-xs text-gray-500" numberOfLines={1}>
              {event.isOnline ? 'Online' : event.location || 'In person'}
            </Text>
          </View>
          {event.recurrenceFreq ? (
            <View className="mt-1 flex-row items-center gap-1">
              <Repeat size={12} color="#6B7280" />
              <Text className="text-xs text-gray-500">
                {recurrenceLabel(event.recurrenceFreq, event.recurrenceInterval ?? 1)}
              </Text>
            </View>
          ) : null}
          <View className="mt-1 flex-row items-center gap-1">
            <Users size={12} color="#6B7280" />
            <Text className="text-xs text-gray-500">
              {event.goingCount} going
            </Text>
          </View>
        </View>
      </View>

      {onRsvp ? (
        <View className="mt-3 flex-row gap-2">
          {(
            [
              ['GOING', 'Going'],
              ['MAYBE', 'Maybe'],
              ['CANT_GO', "Can't go"],
            ] as [EventRsvpStatus, string][]
          ).map(([status, label]) => {
            const active = event.viewerRsvpStatus === status;
            return (
              <TouchableOpacity
                key={status}
                onPress={() => onRsvp(status)}
                disabled={rsvpPending}
                className="flex-1 items-center rounded-full border px-2 py-2"
                style={{
                  borderColor: active ? THEME.primary : THEME.border,
                  backgroundColor: active ? THEME.primarySoft : 'white',
                  opacity: rsvpPending ? 0.6 : 1,
                }}
                accessibilityLabel={label}
              >
                {rsvpPending && active ? (
                  <ActivityIndicator size="small" color={THEME.primary} />
                ) : (
                  <Text
                    className="text-xs font-black"
                    style={{ color: active ? THEME.primary : '#374151' }}
                  >
                    {label}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export function UpcomingEventsModule({
  events,
  onPressEvent,
}: {
  events: EventSummary[];
  onPressEvent: (eventId: string) => void;
}) {
  if (events.length === 0) return null;

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-1.5 px-1">
        <Calendar size={14} color={THEME.primary} />
        <Text className="text-xs font-black uppercase tracking-wide text-gray-500">
          Upcoming
        </Text>
      </View>
      {events.map((event) => (
        <EventCard
          key={event.id}
          event={event}
          title={event.title || 'Event'}
          compact
          onPress={() => onPressEvent(event.id)}
        />
      ))}
    </View>
  );
}
