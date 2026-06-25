import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0a0a0a" } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="player" options={{ presentation: "modal" }} />
      <Stack.Screen name="playlist/[id]" options={{ headerShown: true, title: "Playlist" }} />
    </Stack>
  );
}
