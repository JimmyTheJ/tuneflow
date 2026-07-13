import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "@/lib/api";
import { canManageMembers, formatRoleProfiles } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth";
import type { RoleProfile, User } from "@/types";

export default function FamilyScreen() {
  const currentUser = useAuthStore((state) => state.user);
  const [members, setMembers] = useState<User[]>([]);
  const [roleProfiles, setRoleProfiles] = useState<RoleProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"child" | "adult">("child");
  const selectedProfileIds = roleProfiles
    .filter((profile) => profile.slug === role)
    .map((profile) => profile.id);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [users, profiles] = await Promise.all([api.listUsers(), api.listRoleProfiles()]);
      setMembers(users);
      setRoleProfiles(profiles.filter((profile) => profile.slug === "child" || profile.slug === "adult"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load family members");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createMember = async () => {
    if (!displayName.trim() || !username.trim() || !password.trim()) {
      setError("All fields are required");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api.createUser({
        display_name: displayName.trim(),
        username: username.trim().toLowerCase(),
        password,
        role_profile_ids: selectedProfileIds,
      });
      setDisplayName("");
      setUsername("");
      setPassword("");
      setMessage("Family member added");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (member: User) => {
    if (!canManageMembers(currentUser) || member.id === currentUser?.id) {
      return;
    }
    setError(null);
    try {
      await api.updateUser(member.id, { is_active: !member.is_active });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update account");
    }
  };

  if (loading) {
    return <ActivityIndicator color="#22c55e" style={{ marginTop: 48 }} />;
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.help}>
        Add accounts for family members. Child accounts automatically get parental controls.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add family member</Text>

        <Text style={styles.label}>Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          style={styles.input}
          placeholder="Alex"
          placeholderTextColor="#737373"
        />

        <Text style={styles.label}>Username</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          placeholder="alex"
          placeholderTextColor="#737373"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={styles.input}
          placeholder="••••••"
          placeholderTextColor="#737373"
        />

        <Text style={styles.label}>Account type</Text>
        <View style={styles.chipRow}>
          {(["child", "adult"] as const).map((option) => (
            <Pressable
              key={option}
              style={[styles.chip, role === option && styles.chipActive]}
              onPress={() => setRole(option)}
            >
              <Text style={styles.chipText}>{option}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.button} onPress={() => void createMember()} disabled={saving}>
          <Text style={styles.buttonText}>{saving ? "Adding..." : "Add member"}</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Household</Text>
      {members.map((member) => (
        <View key={member.id} style={styles.memberRow}>
          <View style={styles.memberMeta}>
            <Text style={styles.memberName}>{member.display_name}</Text>
            <Text style={styles.memberSub}>
              @{member.username} · {formatRoleProfiles(member.role_profiles)}
              {!member.is_active ? " · disabled" : ""}
            </Text>
          </View>
          {canManageMembers(currentUser) && member.id !== currentUser?.id ? (
            <Switch value={member.is_active} onValueChange={() => void toggleActive(member)} />
          ) : null}
        </View>
      ))}

      <Pressable style={styles.linkButton} onPress={() => router.push("/parental")}>
        <Text style={styles.linkButtonText}>Manage parental controls →</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    padding: 16,
  },
  help: {
    color: "#a3a3a3",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  card: {
    backgroundColor: "#171717",
    borderRadius: 16,
    padding: 16,
    gap: 8,
    marginBottom: 24,
  },
  cardTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  label: {
    color: "#d4d4d4",
    fontSize: 14,
    marginTop: 4,
  },
  input: {
    backgroundColor: "#0a0a0a",
    color: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 8,
  },
  chip: {
    backgroundColor: "#0a0a0a",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: "#14532d",
  },
  chipText: {
    color: "#fff",
    fontWeight: "600",
    textTransform: "capitalize",
  },
  button: {
    backgroundColor: "#22c55e",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "#052e16",
    fontWeight: "700",
    fontSize: 16,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#262626",
  },
  memberMeta: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  memberSub: {
    color: "#737373",
    fontSize: 13,
  },
  linkButton: {
    marginTop: 24,
    marginBottom: 32,
    paddingVertical: 12,
  },
  linkButtonText: {
    color: "#22c55e",
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    color: "#f87171",
    marginBottom: 8,
  },
  message: {
    color: "#22c55e",
    marginBottom: 8,
  },
});
