import { Pressable, Text, View } from "react-native";

type Props = {
  label: string;
  value: number;
  onChange: (hour: number) => void;
};

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

export function HourPicker({ label, value, onChange }: Props) {
  return (
    <View className="gap-2">
      <Text className="text-sm text-text-secondary">{label}</Text>
      <View className="flex-row items-center gap-4">
        <Pressable
          className="h-11 w-11 items-center justify-center rounded-xl bg-highlight active:bg-hover"
          onPress={() => onChange((value + 23) % 24)}
        >
          <Text className="text-xl font-semibold text-text">−</Text>
        </Pressable>
        <Text className="min-w-[80px] text-center text-lg font-semibold tabular-nums text-text">
          {formatHour(value)}
        </Text>
        <Pressable
          className="h-11 w-11 items-center justify-center rounded-xl bg-highlight active:bg-hover"
          onPress={() => onChange((value + 1) % 24)}
        >
          <Text className="text-xl font-semibold text-text">+</Text>
        </Pressable>
      </View>
    </View>
  );
}
