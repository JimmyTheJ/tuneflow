import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  onVerify: (pin: string) => Promise<boolean>;
  onSuccess: () => void;
  onCancel: () => void;
};

export function PinModal({ visible, title, message, onVerify, onSuccess, onCancel }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const valid = await onVerify(pin);
      if (!valid) {
        setError("Incorrect PIN");
        return;
      }
      setPin("");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify PIN");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setPin("");
    setError(null);
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <TextInput
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={12}
            placeholder="Parent PIN"
            placeholderTextColor="#737373"
            style={styles.input}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.confirmButton} onPress={() => void submit()} disabled={loading}>
              <Text style={styles.confirmText}>{loading ? "..." : "Confirm"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#171717",
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  title: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  message: {
    color: "#a3a3a3",
    fontSize: 15,
    lineHeight: 22,
  },
  input: {
    backgroundColor: "#0a0a0a",
    color: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    letterSpacing: 4,
    textAlign: "center",
  },
  error: {
    color: "#f87171",
    fontSize: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#262626",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelText: {
    color: "#fff",
    fontWeight: "600",
  },
  confirmButton: {
    flex: 1,
    backgroundColor: "#22c55e",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  confirmText: {
    color: "#052e16",
    fontWeight: "700",
  },
});
