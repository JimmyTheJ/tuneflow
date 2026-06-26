import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { getApiUrl, setApiUrl } from "@/lib/settings";
import { useAuthStore } from "@/stores/auth";

export default function SettingsScreen() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [apiUrl, setApiUrlState] = useState("http://localhost:8000");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      setApiUrlState(await getApiUrl());
    })();
  }, []);

  const save = async () => {
    await setApiUrl(apiUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Account</Text>
      {user ? (
        <View style={styles.card}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>
            {user.display_name} ({user.role})
          </Text>
        </View>
      ) : null}

      <Pressable
        style={styles.secondaryButton}
        onPress={() => void logout()}
      >
        <Text style={styles.secondaryButtonText}>Sign out</Text>
      </Pressable>

      {user?.role === "parent" ? (
        <Pressable style={styles.secondaryButton} onPress={() => router.push("/parental")}>
          <Text style={styles.secondaryButtonText}>Parental controls</Text>
        </Pressable>
      ) : null}

      <Text style={[styles.heading, { marginTop: 28 }]}>Server</Text>
      <Text style={styles.help}>
        Point the app at your self-hosted Tuneflow API. On a phone, use your PC’s LAN IP or Tailscale
        address.
      </Text>

      <Text style={styles.label}>API URL</Text>
      <TextInput
        value={apiUrl}
        onChangeText={setApiUrlState}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        placeholder="http://192.168.1.50:8000"
        placeholderTextColor="#737373"
      />

      <Pressable style={styles.button} onPress={() => void save()}>
        <Text style={styles.buttonText}>{saved ? "Saved" : "Save server URL"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  heading: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
  },
  help: {
    color: "#a3a3a3",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  card: {
    backgroundColor: "#171717",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  label: {
    color: "#a3a3a3",
    fontSize: 13,
    marginBottom: 4,
  },
  value: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  input: {
    backgroundColor: "#171717",
    color: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#22c55e",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: {
    color: "#052e16",
    fontWeight: "700",
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: "#171717",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  secondaryButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
});
