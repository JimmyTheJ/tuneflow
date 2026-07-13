import { useState } from "react";
import { Modal, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/Button";

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
      <View className="flex-1 justify-center bg-black/70 px-6">
        <View className="gap-3 rounded-2xl border border-border bg-elevated p-5">
          <Text className="text-xl font-bold tracking-tight text-text">{title}</Text>
          {message ? <Text className="text-[15px] leading-6 text-text-secondary">{message}</Text> : null}
          <TextInput
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={12}
            placeholder="Parent PIN"
            placeholderTextColor="#6a6a6a"
            className="rounded-xl border border-border bg-base px-3.5 py-3 text-center text-lg tracking-[4px] text-text"
          />
          {error ? <Text className="text-sm text-danger-fg">{error}</Text> : null}
          <View className="mt-1 flex-row gap-2.5">
            <Button variant="secondary" className="flex-1" onPress={handleCancel}>
              Cancel
            </Button>
            <Button className="flex-1" loading={loading} onPress={() => void submit()}>
              Confirm
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
