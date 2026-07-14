import "../global.css";
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
      <View className="flex-1 items-center justify-center bg-base">
        <ActivityIndicator color="#1db954" size="large" />
      </View>
    );
  }

  const headerOptions = {
    headerShown: true,
    headerStyle: { backgroundColor: "#0a0a0a" },
    headerTintColor: "#fff",
    headerShadowVisible: false,
    contentStyle: { backgroundColor: "#0a0a0a" },
  };

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#0a0a0a" },
      }}
    >
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="player" options={{ presentation: "modal" }} />
      <Stack.Screen name="queue" options={{ ...headerOptions, presentation: "modal", title: "Queue" }} />
      <Stack.Screen name="family" options={{ ...headerOptions, title: "Family" }} />
      <Stack.Screen name="parental" options={{ ...headerOptions, title: "Parental controls" }} />
      <Stack.Screen name="playlist/[id]" options={{ ...headerOptions, title: "Playlist" }} />
      <Stack.Screen name="artist/[id]" options={{ ...headerOptions, title: "Artist" }} />
      <Stack.Screen name="album/[id]" options={{ ...headerOptions, title: "Album" }} />
    </Stack>
  );
}
