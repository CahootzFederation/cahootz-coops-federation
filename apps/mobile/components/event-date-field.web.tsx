import { View } from 'react-native';

import { Text } from '@/components/ui/text';

const THEME = { border: '#E5E7EB' };

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInputValue(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
  const inputValue = value
    ? mode === 'date'
      ? toDateInputValue(value)
      : toTimeInputValue(value)
    : '';

  return (
    <View>
      <Text className="mb-1 text-xs font-black uppercase text-gray-500">{label}</Text>
      {/* eslint-disable-next-line react/no-unknown-property -- web-only file; renders a real DOM <input> via react-native-web */}
      <input
        type={mode}
        aria-label={label}
        value={inputValue}
        min={minimumDate ? toDateInputValue(minimumDate) : undefined}
        onChange={(event) => {
          const raw = event.target.value;
          if (!raw) return;
          const next = value ? new Date(value.getTime()) : new Date();
          if (mode === 'date') {
            const [year, month, day] = raw.split('-').map(Number);
            next.setFullYear(year, month - 1, day);
          } else {
            const [hours, minutes] = raw.split(':').map(Number);
            next.setHours(hours, minutes, 0, 0);
          }
          onChange(next);
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          borderRadius: 12,
          border: `1px solid ${THEME.border}`,
          background: 'white',
          padding: '12px 16px',
          fontSize: 16,
          color: '#111827',
          fontFamily: 'inherit',
        }}
      />
    </View>
  );
}
