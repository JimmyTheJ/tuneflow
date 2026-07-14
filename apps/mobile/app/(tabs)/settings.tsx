import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

import { PinModal } from "@/components/PinModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/api";
import {
  canManageMembers,
  canManageParentalControls,
  canSetParentPin,
  formatRoleProfiles,
  isChildProfile,
} from "@/lib/permissions";
import { getApiUrl, normalizeApiUrl, setApiUrl } from "@/lib/settings";
import { useAuthStore } from "@/stores/auth";
import { refreshPlayerMediaConfig } from "@/stores/player";
import type { ParentalSettings, ScrobblerConnectionStatus, ScrobblerProviderInfo } from "@/types";

function SettingsLink({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="mb-2 flex-row items-center gap-3 rounded-xl border border-border/60 bg-elevated px-4 py-3.5 active:bg-highlight"
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-highlight">
        <Ionicons name={icon} size={18} color="#1db954" />
      </View>
      <Text className="flex-1 font-semibold text-text">{label}</Text>
      <Ionicons name="chevron-forward" size={16} color="#6a6a6a" />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [apiUrl, setApiUrlState] = useState("http://localhost:8000");
  const [saved, setSaved] = useState(false);
  const [parentPin, setParentPin] = useState("");
  const [hasParentPin, setHasParentPin] = useState(false);
  const [childSettings, setChildSettings] = useState<ParentalSettings | null>(null);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinAction, setPinAction] = useState<"logout" | "switch" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrobblerProviders, setScrobblerProviders] = useState<ScrobblerProviderInfo[]>([]);
  const [scrobblerStatuses, setScrobblerStatuses] = useState<Record<string, ScrobblerConnectionStatus>>({});
  const [pendingLinkTokens, setPendingLinkTokens] = useState<Record<string, string>>({});
  const [scrobblerError, setScrobblerError] = useState<string | null>(null);

  const isChild = isChildProfile(user);
  const canManageFamily = canManageMembers(user);
  const canManageParental = canManageParentalControls(user);
  const canPin = canSetParentPin(user);

  useEffect(() => {
    void (async () => {
      setApiUrlState(await getApiUrl());
      if (canPin) {
        try {
          const status = await api.parentPinStatus();
          setHasParentPin(status.has_pin);
        } catch {
          /* ignore */
        }
      }
      if (isChild) {
        try {
          setChildSettings(await api.getMyChildSettings());
        } catch {
          /* ignore */
        }
      }
    })();
  }, [isChild, canPin]);

  useEffect(() => {
    void (async () => {
      try {
        const providers = await api.listScrobblerProviders();
        setScrobblerProviders(providers);
        const statuses = await Promise.all(providers.map((provider) => api.getScrobblerStatus(provider.id)));
        setScrobblerStatuses(Object.fromEntries(statuses.map((status) => [status.provider, status])));
      } catch {
        /* scrobbling not configured */
      }
    })();
  }, []);

  const refreshScrobblerStatus = async (providerId: string) => {
    const status = await api.getScrobblerStatus(providerId);
    setScrobblerStatuses((current) => ({ ...current, [providerId]: status }));
  };

  const startScrobblerLink = async (providerId: string) => {
    setScrobblerError(null);
    try {
      const link = await api.startScrobblerLink(providerId);
      setPendingLinkTokens((current) => ({ ...current, [providerId]: link.token }));
      await Linking.openURL(link.authorize_url);
      setMessage(`Authorize ${providerId}, then tap Complete link below.`);
    } catch (err) {
      setScrobblerError(err instanceof Error ? err.message : "Could not start scrobbler link");
    }
  };

  const completeScrobblerLink = async (providerId: string) => {
    const token = pendingLinkTokens[providerId];
    if (!token) {
      setScrobblerError("Start linking first so Tuneflow can finish the connection.");
      return;
    }
    setScrobblerError(null);
    try {
      await api.completeScrobblerLink(providerId, token);
      setPendingLinkTokens((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
      await refreshScrobblerStatus(providerId);
      setMessage("Scrobbler account linked for this profile.");
    } catch (err) {
      setScrobblerError(err instanceof Error ? err.message : "Could not complete scrobbler link");
    }
  };

  const toggleScrobbling = async (providerId: string, enabled: boolean) => {
    setScrobblerError(null);
    try {
      await api.updateScrobblerSettings(providerId, enabled);
      await refreshScrobblerStatus(providerId);
    } catch (err) {
      setScrobblerError(err instanceof Error ? err.message : "Could not update scrobbling settings");
    }
  };

  const unlinkScrobbler = async (providerId: string) => {
    setScrobblerError(null);
    try {
      await api.unlinkScrobbler(providerId);
      await refreshScrobblerStatus(providerId);
      setMessage("Scrobbler account unlinked.");
    } catch (err) {
      setScrobblerError(err instanceof Error ? err.message : "Could not unlink scrobbler account");
    }
  };

  const saveServer = async () => {
    const normalized = normalizeApiUrl(apiUrl);
    if (!normalized) {
      setError("Enter a valid server address");
      return;
    }
    await setApiUrl(normalized);
    await refreshPlayerMediaConfig();
    setApiUrlState(normalized);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const saveParentPin = async () => {
    if (parentPin.length < 4) {
      setError("PIN must be at least 4 characters");
      return;
    }
    setError(null);
    try {
      await api.setParentPin(parentPin);
      setHasParentPin(true);
      setParentPin("");
      setMessage("Parent PIN saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save PIN");
    }
  };

  const requestProtectedAction = async (action: "logout" | "switch") => {
    if (!isChild) {
      await logout();
      if (action === "switch") router.replace("/(auth)/login");
      return;
    }

    try {
      const { enforced } = await api.parentPinEnforced();
      if (!enforced) {
        await logout();
        if (action === "switch") router.replace("/(auth)/login");
        return;
      }
    } catch {
      /* fall through */
    }

    setPinAction(action);
    setPinModalVisible(true);
  };

  const handlePinSuccess = async () => {
    setPinModalVisible(false);
    await logout();
    if (pinAction === "switch") router.replace("/(auth)/login");
    setPinAction(null);
  };

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-2" contentContainerStyle={{ paddingBottom: 40 }}>
      <Text className="mb-3 text-3xl font-bold tracking-tight text-text">Settings</Text>

      {user ? (
        <Card className="mb-4">
          <Text className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Signed in as
          </Text>
          <Text className="mt-1 text-lg font-bold text-text">{user.display_name}</Text>
          <Text className="mt-1 text-sm text-text-secondary">
            {formatRoleProfiles(user.role_profiles)}
          </Text>
        </Card>
      ) : null}

      {isChild && childSettings ? (
        <Card className="mb-4">
          <Text className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Your limits
          </Text>
          <Text className="mt-1 text-sm text-text-secondary">
            {childSettings.max_daily_minutes != null
              ? `${childSettings.max_daily_minutes} min/day`
              : "No daily limit"}
            {" · "}
            {childSettings.search_enabled ? "Search on" : "Search off"}
          </Text>
        </Card>
      ) : null}

      <View className="mb-4 gap-2">
        <Button variant="secondary" block onPress={() => void requestProtectedAction("switch")}>
          Switch account
        </Button>
        <Button variant="ghost" block onPress={() => void requestProtectedAction("logout")}>
          <View className="flex-row items-center gap-2">
            <Ionicons name="log-out-outline" size={16} color="#b3b3b3" />
            <Text className="font-semibold text-text-secondary">Sign out</Text>
          </View>
        </Button>
      </View>

      {canManageFamily || canManageParental ? (
        <View className="mb-4">
          <Text className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
            Management
          </Text>
          {canManageFamily ? (
            <SettingsLink icon="people" label="Household members" onPress={() => router.push("/family")} />
          ) : null}
          {canManageParental ? (
            <SettingsLink icon="shield-checkmark" label="Parental controls" onPress={() => router.push("/parental")} />
          ) : null}
        </View>
      ) : null}

      {canPin ? (
        <Card className="mb-4 gap-3">
          <Text className="text-base font-bold text-text">Parent PIN</Text>
          <Text className="text-sm text-text-secondary">
            Required for children to switch accounts or sign out on a shared device.
            {hasParentPin ? " PIN is set." : " No PIN set yet."}
          </Text>
          <TextInput
            value={parentPin}
            onChangeText={setParentPin}
            keyboardType="number-pad"
            secureTextEntry
            className="rounded-xl border border-border bg-base px-3.5 py-3 text-base text-text"
            placeholder="4+ digit PIN"
            placeholderTextColor="#6a6a6a"
          />
          <Button variant="secondary" block onPress={() => void saveParentPin()}>
            {hasParentPin ? "Update parent PIN" : "Set parent PIN"}
          </Button>
        </Card>
      ) : null}

      {scrobblerProviders.length > 0 ? (
        <View className="mb-4">
          <Text className="mb-1 text-base font-bold text-text">Scrobbling</Text>
          <Text className="mb-3 text-sm text-text-secondary">
            Link a scrobbler account for {user?.display_name}. Each family member links their own
            account.
          </Text>
          {scrobblerProviders.map((provider) => {
            const status = scrobblerStatuses[provider.id];
            const pendingToken = pendingLinkTokens[provider.id];
            return (
              <Card key={provider.id} className="mb-3 gap-3">
                <Text className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {provider.name}
                </Text>
                {status?.linked ? (
                  <>
                    <Text className="font-semibold text-text">Linked as {status.username}</Text>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm text-text-secondary">Scrobble plays</Text>
                      <Switch
                        value={status.scrobbling_enabled}
                        onValueChange={(enabled) => void toggleScrobbling(provider.id, enabled)}
                        trackColor={{ false: "#3a3a3a", true: "#14532d" }}
                        thumbColor={status.scrobbling_enabled ? "#1db954" : "#b3b3b3"}
                      />
                    </View>
                    <Button variant="secondary" block onPress={() => void unlinkScrobbler(provider.id)}>
                      Unlink {provider.name}
                    </Button>
                  </>
                ) : (
                  <>
                    <Text className="text-sm text-text-secondary">Not linked for this profile.</Text>
                    <Button block onPress={() => void startScrobblerLink(provider.id)}>
                      Connect {provider.name}
                    </Button>
                    {pendingToken ? (
                      <Button
                        variant="secondary"
                        block
                        onPress={() => void completeScrobblerLink(provider.id)}
                      >
                        Complete link
                      </Button>
                    ) : null}
                  </>
                )}
              </Card>
            );
          })}
          {scrobblerError ? <Text className="text-sm text-danger-fg">{scrobblerError}</Text> : null}
        </View>
      ) : null}

      {!isChild ? (
        <Card className="mb-4 gap-3">
          <Text className="text-base font-bold text-text">Server</Text>
          <Text className="text-sm text-text-secondary">
            Point the app at your self-hosted Tuneflow API.
          </Text>
          <TextInput
            value={apiUrl}
            onChangeText={setApiUrlState}
            autoCapitalize="none"
            autoCorrect={false}
            className="rounded-xl border border-border bg-base px-3.5 py-3 text-base text-text"
            placeholder="http://192.168.1.50:8000"
            placeholderTextColor="#6a6a6a"
          />
          <Button block onPress={() => void saveServer()}>
            {saved ? "Saved" : "Save server URL"}
          </Button>
        </Card>
      ) : null}

      {message ? <Text className="mb-2 text-sm text-accent">{message}</Text> : null}
      {error ? <Text className="mb-2 text-sm text-danger-fg">{error}</Text> : null}

      <PinModal
        visible={pinModalVisible}
        title="Parent PIN required"
        message="Enter a parent PIN to switch accounts or sign out."
        onVerify={async (pin) => (await api.verifyParentPin(pin)).valid}
        onSuccess={() => void handlePinSuccess()}
        onCancel={() => {
          setPinModalVisible(false);
          setPinAction(null);
        }}
      />
    </ScrollView>
  );
}
