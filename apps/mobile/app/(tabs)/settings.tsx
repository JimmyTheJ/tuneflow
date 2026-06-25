import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { getApiToken, getApiUrl, setApiToken, setApiUrl } from "@/lib/settings";

export default function SettingsScreen() {
  const [apiUrl, setApiUrlState] = useState("http://localhost:8000");
  const [apiToken, setApiTokenState] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      setApiUrlState(await getApiUrl());
      setApiTokenState(await getApiToken());
    })();
  }, []);

  const save = async () => {
    await setApiUrl(apiUrl);
    await setApiToken(apiToken);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Server</Text>
      <Text style={styles.help}>
        Point the app at your self-hosted Tuneflow API. On a real phone, use your PC’s LAN IP or a
        Tailscale address instead of localhost.
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

      <Text style={styles.label}>API token</Text>
      <TextInput
        value={apiToken}
        onChangeText={setApiTokenState}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={styles.input}
        placeholder="Matches TUNEFLOW_API_TOKEN on the server"
        placeholderTextColor="#737373"
      />

      <Pressable style={styles.button} onPress={() => void save()}>
        <Text style={styles.buttonText}>{saved ? "Saved" : "Save settings"}</Text>
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
  label: {
    color: "#d4d4d4",
    fontSize: 14,
    marginBottom: 8,
    marginTop: 12,
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
    marginTop: 24,
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
});
