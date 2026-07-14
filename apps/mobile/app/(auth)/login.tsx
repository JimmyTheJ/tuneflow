import { LinearGradient } from "expo-linear-gradient";
import { router, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/auth";

export default function LoginScreen() {
  const login = useAuthStore((state) => state.login);
  const [householdSlug, setHouseholdSlug] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await login(householdSlug.trim().toLowerCase(), username.trim().toLowerCase(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
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
        <Text className="text-4xl font-extrabold tracking-tight text-text">Welcome back</Text>
        <Text className="mb-4 text-base text-text-secondary">
          Sign in with your household, username, and password
        </Text>

        <TextInput
          value={householdSlug}
          onChangeText={setHouseholdSlug}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Household (e.g. siglerfive)"
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
          placeholder="Password"
          placeholderTextColor="#6a6a6a"
          className="rounded-xl border border-border bg-elevated px-3.5 py-3.5 text-base text-text"
        />

        {error ? <Text className="text-sm text-danger-fg">{error}</Text> : null}

        <Button block loading={loading} onPress={() => void submit()} className="mt-2">
          Sign in
        </Button>
        <Pressable onPress={() => router.push("/(auth)/server" as Href)} className="mt-4 py-2">
          <Text className="text-center text-sm text-text-secondary">Change server</Text>
        </Pressable>
        <Text className="mt-2 text-center text-xs text-text-muted">
          Root administrators: use household system.
        </Text>
      </View>
    </View>
  );
}
