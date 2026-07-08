import { Stack, router, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

export default function RootLayout() {
  const hydrate = useAuthStore((state) => state.hydrate);
  const user = useAuthStore((state) => state.user);
  const isReady = useAuthStore((state) => state.isReady);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const segments = useSegments();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    void (async () => {
      try {
        const status = await api.setupStatus();
        setNeedsSetup(status.needs_setup);
      } catch {
        setNeedsSetup(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isReady || needsSetup === null) {
      return;
    }

    const inAuth = segments[0] === "(auth)";

    if (needsSetup && !inAuth) {
      router.replace("/(auth)/setup");
      return;
    }

    if (!needsSetup && !user && !inAuth) {
      router.replace("/(auth)/login");
      return;
    }

    if (user && inAuth) {
      router.replace("/(tabs)");
    }
  }, [isReady, needsSetup, user, segments]);

  if (!isReady || needsSetup === null) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color="#22c55e" size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0a0a0a" } }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="player" options={{ presentation: "modal" }} />
      <Stack.Screen name="family" options={{ headerShown: true, title: "Family" }} />
      <Stack.Screen name="parental" options={{ headerShown: true, title: "Parental controls" }} />
      <Stack.Screen name="playlist/[id]" options={{ headerShown: true, title: "Playlist" }} />
    </Stack>
  );
}
