import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/auth";

export default function SetupScreen() {
  const setup = useAuthStore((state) => state.setup);
  const [displayName, setDisplayName] = useState("Parent");
  const [username, setUsername] = useState("parent");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await setup(username.trim().toLowerCase(), password, displayName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-base">
      <LinearGradient
        colors={["#14532d", "#0a0a0a", "#0a0a0a"]}
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />
      <View className="flex-1 justify-center gap-3 px-6">
        <Text className="text-sm font-bold uppercase tracking-widest text-accent">Tuneflow</Text>
        <Text className="text-4xl font-extrabold tracking-tight text-text">Welcome</Text>
        <Text className="mb-4 text-base leading-6 text-text-secondary">
          Create the local parent account for your household
        </Text>

        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Display name"
          placeholderTextColor="#6a6a6a"
          className="rounded-xl border border-border bg-elevated px-3.5 py-3.5 text-base text-text"
        />
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Username"
          placeholderTextColor="#6a6a6a"
          className="rounded-xl border border-border bg-elevated px-3.5 py-3.5 text-base text-text"
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password (8+ characters)"
          placeholderTextColor="#6a6a6a"
          className="rounded-xl border border-border bg-elevated px-3.5 py-3.5 text-base text-text"
        />

        {error ? <Text className="text-sm text-danger-fg">{error}</Text> : null}

        <Button block loading={loading} onPress={() => void submit()} className="mt-2">
          Create account
        </Button>
      </View>
    </View>
  );
}
