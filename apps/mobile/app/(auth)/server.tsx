import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { getApiUrl, hasConfiguredServer, normalizeApiUrl, setApiUrl } from "@/lib/settings";
import { useAuthStore } from "@/stores/auth";
import { useBootstrapStore } from "@/stores/bootstrap";
import { refreshPlayerMediaConfig } from "@/stores/player";

export default function ServerScreen() {
  const setServerOk = useBootstrapStore((state) => state.setServerOk);
  const hydrate = useAuthStore((state) => state.hydrate);
  const [serverUrl, setServerUrl] = useState("");
  const [hadSavedServer, setHadSavedServer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [url, configured] = await Promise.all([getApiUrl(), hasConfiguredServer()]);
      setServerUrl(url);
      setHadSavedServer(configured);
    })();
  }, []);

  const connect = async () => {
    const normalized = normalizeApiUrl(serverUrl);
    if (!normalized) {
      setError("Enter your server address");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await setApiUrl(normalized);
      await refreshPlayerMediaConfig();
      const status = await api.testConnection();
      setServerOk(status.needs_setup);
      await hydrate();
      const user = useAuthStore.getState().user;

      if (status.needs_setup) {
        router.replace("/(auth)/setup");
        return;
      }
      if (user) {
        router.replace("/(tabs)");
        return;
      }
      router.replace("/(auth)/login");
    } catch {
      setError("Could not reach that server. Check the address and try again.");
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
        <Text className="text-4xl font-extrabold tracking-tight text-text">Connect to server</Text>
        <Text className="mb-4 text-base leading-6 text-text-secondary">
          {hadSavedServer
            ? "We couldn't reach your saved server. Check the address or your network, then try again."
            : "Enter the address of your self-hosted Tuneflow API to get started."}
        </Text>

        <TextInput
          value={serverUrl}
          onChangeText={setServerUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="192.168.1.50:8000"
          placeholderTextColor="#6a6a6a"
          className="rounded-xl border border-border bg-elevated px-3.5 py-3.5 text-base text-text"
        />
        <Text className="text-xs text-text-muted">http:// is added automatically if omitted.</Text>

        {error ? <Text className="text-sm text-danger-fg">{error}</Text> : null}

        <Button block loading={loading} onPress={() => void connect()} className="mt-2">
          Connect
        </Button>
        {hadSavedServer ? (
          <Pressable
            onPress={() => router.replace("/(auth)/login")}
            disabled={loading}
            className="mt-4 py-2"
          >
            <Text className="text-center text-sm text-text-secondary">Back to sign in</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
