import { useState } from 'react';
import { Platform, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { Text } from '@/components/ui/text';

const THEME = {
  primary: '#FF6B00',
  muted: '#6B7280',
  border: '#E5E7EB',
};

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function EventDateField({
  label,
  value,
  onChange,
  mode,
  minimumDate,
}: {
  label: string;
  value: Date | null;
  onChange: (date: Date) => void;
  mode: 'date' | 'time';
  minimumDate?: Date;
}) {
  const [open, setOpen] = useState(false);
  const display = value || new Date();

  return (
    <View>
      <Text className="mb-1 text-xs font-black uppercase text-gray-500">{label}</Text>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        className="rounded-xl border bg-white px-4 py-3"
        style={{ borderColor: THEME.border }}
        accessibilityLabel={label}
      >
        <Text className="text-base text-gray-900">
          {value ? (mode === 'date' ? formatDate(value) : formatTime(value)) : `Select ${mode}`}
        </Text>
      </TouchableOpacity>

      {open ? (
        <>
          <DateTimePicker
            value={display}
            mode={mode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={minimumDate}
            onChange={(event, selected) => {
              if (Platform.OS === 'android') {
                setOpen(false);
                if (event.type === 'set' && selected) onChange(selected);
                return;
              }
              if (selected) onChange(selected);
            }}
          />
          {Platform.OS === 'ios' ? (
            <TouchableOpacity
              onPress={() => setOpen(false)}
              className="mt-2 items-center rounded-full px-4 py-2"
              style={{ backgroundColor: THEME.primary }}
            >
              <Text className="text-xs font-black text-white">Done</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
