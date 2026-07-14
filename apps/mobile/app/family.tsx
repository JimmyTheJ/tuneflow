import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { canManageMembers, formatRoleProfiles } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth";
import type { RoleProfile, User } from "@/types";

type HouseholdMemberGroup = {
  key: string;
  householdName: string;
  members: User[];
};

function groupMembersByHousehold(members: User[]): HouseholdMemberGroup[] {
  const groups = new Map<string, HouseholdMemberGroup>();
  for (const member of members) {
    const key = member.household_id?.toString() ?? "none";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        householdName: member.household_name ?? "No household",
        members: [],
      };
      groups.set(key, group);
    }
    group.members.push(member);
  }
  return Array.from(groups.values()).sort((a, b) => a.householdName.localeCompare(b.householdName));
}

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
    return (
      <View className="flex-1 items-center justify-center bg-base">
        <ActivityIndicator color="#1db954" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-base px-4 pt-4" contentContainerStyle={{ paddingBottom: 40 }}>
      <Text className="mb-4 text-[15px] leading-6 text-text-secondary">
        {currentUser?.is_root_admin
          ? "Household members across all households, grouped by household."
          : "Add accounts for family members. Child accounts automatically get parental controls."}
      </Text>

      {error ? <Text className="mb-2 text-sm text-danger-fg">{error}</Text> : null}
      {message ? <Text className="mb-2 text-sm text-accent">{message}</Text> : null}

      <Card className="mb-6 gap-2">
        <Text className="mb-1 text-lg font-bold text-text">Add family member</Text>

        <Text className="mt-1 text-sm text-text-secondary">Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          className="rounded-xl border border-border bg-base px-3.5 py-3 text-base text-text"
          placeholder="Alex"
          placeholderTextColor="#6a6a6a"
        />

        <Text className="mt-1 text-sm text-text-secondary">Username</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-xl border border-border bg-base px-3.5 py-3 text-base text-text"
          placeholder="alex"
          placeholderTextColor="#6a6a6a"
        />

        <Text className="mt-1 text-sm text-text-secondary">Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          className="rounded-xl border border-border bg-base px-3.5 py-3 text-base text-text"
          placeholder="••••••"
          placeholderTextColor="#6a6a6a"
        />

        <Text className="mt-1 text-sm text-text-secondary">Account type</Text>
        <View className="mb-2 mt-1 flex-row gap-2">
          {(["child", "adult"] as const).map((option) => (
            <Pressable
              key={option}
              className={`rounded-full px-3.5 py-2 ${role === option ? "bg-accent-dim" : "bg-highlight"}`}
              onPress={() => setRole(option)}
            >
              <Text className="font-semibold capitalize text-text">{option}</Text>
            </Pressable>
          ))}
        </View>

        <Button block loading={saving} onPress={() => void createMember()}>
          Add member
        </Button>
      </Card>

      <Text className="mb-3 text-lg font-bold text-text">Members</Text>
      {(currentUser?.is_root_admin ? groupMembersByHousehold(members) : [{ key: "mine", householdName: "", members }]).map(
        (group) => (
          <View key={group.key}>
            {currentUser?.is_root_admin ? (
              <Text className="mb-2 mt-2 text-base font-semibold text-text">{group.householdName}</Text>
            ) : null}
            {group.members.map((member) => (
              <View
                key={member.id}
                className="flex-row items-center justify-between border-b border-border py-3"
              >
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="text-base font-semibold text-text">{member.display_name}</Text>
                  <Text className="text-[13px] text-text-muted">
                    @{member.username} · {formatRoleProfiles(member.role_profiles)}
                    {!member.is_active ? " · disabled" : ""}
                  </Text>
                </View>
                {canManageMembers(currentUser) && member.id !== currentUser?.id ? (
                  <Switch
                    value={member.is_active}
                    onValueChange={() => void toggleActive(member)}
                    trackColor={{ false: "#3a3a3a", true: "#14532d" }}
                    thumbColor={member.is_active ? "#1db954" : "#b3b3b3"}
                  />
                ) : null}
              </View>
            ))}
          </View>
        ),
      )}

      <Pressable className="mb-8 mt-6 py-3" onPress={() => router.push("/parental")}>
        <Text className="text-base font-semibold text-accent">Manage parental controls →</Text>
      </Pressable>
    </ScrollView>
  );
}
