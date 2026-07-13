import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

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
    <View style={styles.container}>
      <Text style={styles.title}>Tuneflow</Text>
      <Text style={styles.subtitle}>Sign in with your household, username, and password</Text>

      <TextInput
        value={householdSlug}
        onChangeText={setHouseholdSlug}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Household (e.g. siglerfive)"
        placeholderTextColor="#737373"
        style={styles.input}
      />
      <TextInput
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Username"
        placeholderTextColor="#737373"
        style={styles.input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
        placeholderTextColor="#737373"
        style={styles.input}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.button} onPress={() => void submit()} disabled={loading}>
        {loading ? <ActivityIndicator color="#052e16" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    padding: 24,
    justifyContent: "center",
    gap: 12,
  },
  title: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "800",
    marginBottom: 4,
  },
  subtitle: {
    color: "#a3a3a3",
    fontSize: 16,
    marginBottom: 20,
  },
  input: {
    backgroundColor: "#171717",
    color: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#22c55e",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "#052e16",
    fontWeight: "700",
    fontSize: 16,
  },
  error: {
    color: "#f87171",
  },
});
