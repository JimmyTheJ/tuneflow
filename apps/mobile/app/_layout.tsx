import "../global.css";
import { Stack, router, useSegments, type Href } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

import { useAuthStore } from "@/stores/auth";
import { useBootstrapStore } from "@/stores/bootstrap";

const SERVER_ROUTE = "/(auth)/server" as Href;

export default function RootLayout() {
  const hydrate = useAuthStore((state) => state.hydrate);
  const user = useAuthStore((state) => state.user);
  const isReady = useAuthStore((state) => state.isReady);
  const serverCheck = useBootstrapStore((state) => state.serverCheck);
  const needsSetup = useBootstrapStore((state) => state.needsSetup);
  const runServerCheck = useBootstrapStore((state) => state.runServerCheck);
  const segments = useSegments();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    void runServerCheck();
  }, [runServerCheck]);

  useEffect(() => {
    if (!isReady || serverCheck === "pending") {
      return;
    }

    const inAuth = segments[0] === "(auth)";
    const onServer = segments[1] === ("server" as typeof segments[1]);

    if (serverCheck === "needs-config") {
      if (!onServer) {
        router.replace(SERVER_ROUTE);
      }
      return;
    }

    if (needsSetup === null) {
      return;
    }

    if (needsSetup && !inAuth) {
      router.replace("/(auth)/setup");
      return;
    }

    if (!needsSetup && !user && !inAuth) {
      router.replace("/(auth)/login");
      return;
    }

    if (user && inAuth && !onServer) {
      router.replace("/(tabs)");
    }
  }, [isReady, serverCheck, needsSetup, user, segments]);

  if (!isReady || serverCheck === "pending") {
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
