import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { MiniPlayer } from "@/components/MiniPlayer";

export default function TabLayout() {
  return (
    <View className="flex-1 bg-base">
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: "#0a0a0a" },
          headerTintColor: "#fff",
          headerShadowVisible: false,
          tabBarStyle: {
            backgroundColor: "rgba(18,18,18,0.95)",
            borderTopColor: "#282828",
            borderTopWidth: 0.5,
          },
          tabBarActiveTintColor: "#1db954",
          tabBarInactiveTintColor: "#6a6a6a",
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="discover"
          options={{
            title: "Discover",
            tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: "Search",
            tabBarIcon: ({ color, size }) => <Ionicons name="search" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: "Library",
            tabBarIcon: ({ color, size }) => <Ionicons name="library" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "Settings",
            tabBarIcon: ({ color, size }) => <Ionicons name="settings" color={color} size={size} />,
          }}
        />
      </Tabs>
      <MiniPlayer />
    </View>
  );
}
