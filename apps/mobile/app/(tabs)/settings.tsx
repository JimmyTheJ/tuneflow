import { router } from "expo-router";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { PinModal } from "@/components/PinModal";
import { api } from "@/lib/api";
import { getApiUrl, setApiUrl } from "@/lib/settings";
import { useAuthStore } from "@/stores/auth";
import type { ParentalSettings, ScrobblerConnectionStatus, ScrobblerProviderInfo } from "@/types";

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

  const isChild = user?.role === "child";
  const isParent = user?.role === "parent";

  useEffect(() => {
    void (async () => {
      setApiUrlState(await getApiUrl());
      if (isParent) {
        try {
          const status = await api.parentPinStatus();
          setHasParentPin(status.has_pin);
        } catch {
          // ignore
        }
      }
      if (isChild) {
        try {
          setChildSettings(await api.getMyChildSettings());
        } catch {
          // ignore
        }
      }
    })();
  }, [isChild, isParent]);

  useEffect(() => {
    void (async () => {
      try {
        const providers = await api.listScrobblerProviders();
        setScrobblerProviders(providers);
        const statuses = await Promise.all(providers.map((provider) => api.getScrobblerStatus(provider.id)));
        setScrobblerStatuses(Object.fromEntries(statuses.map((status) => [status.provider, status])));
      } catch {
        // scrobbling not configured
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
    await setApiUrl(apiUrl);
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
      if (action === "logout") {
        await logout();
      } else {
        await logout();
        router.replace("/(auth)/login");
      }
      return;
    }

    try {
      const { enforced } = await api.parentPinEnforced();
      if (!enforced) {
        if (action === "logout") {
          await logout();
        } else {
          await logout();
          router.replace("/(auth)/login");
        }
        return;
      }
    } catch {
      // fall through to PIN modal
    }

    setPinAction(action);
    setPinModalVisible(true);
  };

  const handlePinSuccess = async () => {
    setPinModalVisible(false);
    if (pinAction === "logout") {
      await logout();
    } else if (pinAction === "switch") {
      await logout();
      router.replace("/(auth)/login");
    }
    setPinAction(null);
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

      {isChild && childSettings ? (
        <View style={styles.card}>
          <Text style={styles.label}>Your limits</Text>
          <Text style={styles.limitText}>
            {childSettings.max_daily_minutes != null
              ? `${childSettings.max_daily_minutes} min/day`
              : "No daily limit"}
            {" · "}
            {childSettings.search_enabled ? "Search on" : "Search off"}
          </Text>
        </View>
      ) : null}

      <Pressable style={styles.secondaryButton} onPress={() => void requestProtectedAction("switch")}>
        <Text style={styles.secondaryButtonText}>Switch account</Text>
      </Pressable>

      <Pressable style={styles.secondaryButton} onPress={() => void requestProtectedAction("logout")}>
        <Text style={styles.secondaryButtonText}>Sign out</Text>
      </Pressable>

      {isParent ? (
        <>
          <Pressable style={styles.secondaryButton} onPress={() => router.push("/family")}>
            <Text style={styles.secondaryButtonText}>Family members</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => router.push("/parental")}>
            <Text style={styles.secondaryButtonText}>Parental controls</Text>
          </Pressable>

          <Text style={[styles.heading, { marginTop: 20, fontSize: 22 }]}>Parent PIN</Text>
          <Text style={styles.help}>
            Required for children to switch accounts or sign out on a shared device.
            {hasParentPin ? " PIN is set." : " No PIN set yet."}
          </Text>
          <TextInput
            value={parentPin}
            onChangeText={setParentPin}
            keyboardType="number-pad"
            secureTextEntry
            style={styles.input}
            placeholder="4+ digit PIN"
            placeholderTextColor="#737373"
          />
          <Pressable style={styles.secondaryButton} onPress={() => void saveParentPin()}>
            <Text style={styles.secondaryButtonText}>
              {hasParentPin ? "Update parent PIN" : "Set parent PIN"}
            </Text>
          </Pressable>
        </>
      ) : null}

      {scrobblerProviders.length > 0 ? (
        <>
          <Text style={[styles.heading, { marginTop: 20, fontSize: 22 }]}>Scrobbling</Text>
          <Text style={styles.help}>
            Link a scrobbler account for {user?.display_name}. Each family member links their own account.
          </Text>
          {scrobblerProviders.map((provider) => {
            const status = scrobblerStatuses[provider.id];
            const pendingToken = pendingLinkTokens[provider.id];
            return (
              <View style={styles.card} key={provider.id}>
                <Text style={styles.label}>{provider.name}</Text>
                {status?.linked ? (
                  <>
                    <Text style={styles.value}>Linked as {status.username}</Text>
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => void toggleScrobbling(provider.id, !status.scrobbling_enabled)}
                    >
                      <Text style={styles.secondaryButtonText}>
                        {status.scrobbling_enabled ? "Scrobbling on" : "Scrobbling off"}
                      </Text>
                    </Pressable>
                    <Pressable style={styles.secondaryButton} onPress={() => void unlinkScrobbler(provider.id)}>
                      <Text style={styles.secondaryButtonText}>Unlink {provider.name}</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.help}>Not linked for this profile.</Text>
                    <Pressable style={styles.button} onPress={() => void startScrobblerLink(provider.id)}>
                      <Text style={styles.buttonText}>Connect {provider.name}</Text>
                    </Pressable>
                    {pendingToken ? (
                      <Pressable style={styles.secondaryButton} onPress={() => void completeScrobblerLink(provider.id)}>
                        <Text style={styles.secondaryButtonText}>Complete link</Text>
                      </Pressable>
                    ) : null}
                  </>
                )}
              </View>
            );
          })}
          {scrobblerError ? <Text style={styles.error}>{scrobblerError}</Text> : null}
        </>
      ) : null}

      {!isChild ? (
        <>
          <Text style={[styles.heading, { marginTop: 28 }]}>Server</Text>
          <Text style={styles.help}>
            Point the app at your self-hosted Tuneflow API.
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
          <Pressable style={styles.button} onPress={() => void saveServer()}>
            <Text style={styles.buttonText}>{saved ? "Saved" : "Save server URL"}</Text>
          </Pressable>
        </>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

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
    marginBottom: 12,
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
  limitText: {
    color: "#d4d4d4",
    fontSize: 15,
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
  message: {
    color: "#22c55e",
    marginTop: 12,
  },
  error: {
    color: "#f87171",
    marginTop: 12,
  },
});
