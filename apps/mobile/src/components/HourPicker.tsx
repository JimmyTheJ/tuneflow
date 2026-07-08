import { Pressable, StyleSheet, Text, View } from "react-native";

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
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable style={styles.button} onPress={() => onChange((value + 23) % 24)}>
          <Text style={styles.buttonText}>−</Text>
        </Pressable>
        <Text style={styles.value}>{formatHour(value)}</Text>
        <Pressable style={styles.button} onPress={() => onChange((value + 1) % 24)}>
          <Text style={styles.buttonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  label: {
    color: "#d4d4d4",
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "600",
  },
  value: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    minWidth: 80,
    textAlign: "center",
  },
});
