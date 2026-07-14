import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api } from "@/lib/api";
import { canManageMembers, canManageParentalControls, formatRoleProfiles } from "@/lib/permissions";
import { useAuthStore } from "@/stores/authStore";
import type { RoleProfile, User } from "@/types";

function canEditUser(current: User, target: User) {
  if (target.deleted_at) return false;
  if (current.is_root_admin) return true;
  if (!canManageMembers(current)) return false;
  return target.household_id === current.household_id;
}

function canToggleActive(current: User, target: User) {
  if (!canEditUser(current, target) || target.id === current.id) return false;
  return true;
}

function canSoftDelete(current: User, target: User) {
  return current.is_root_admin && target.id !== current.id && !target.deleted_at;
}

function assignableProfiles(profiles: RoleProfile[]) {
  return profiles.filter((profile) => profile.slug !== "household_admin");
}

type HouseholdMemberGroup = {
  key: string;
  householdName: string;
  householdSlug: string | null;
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
        householdSlug: member.household_slug ?? null,
        members: [],
      };
      groups.set(key, group);
    }
    group.members.push(member);
  }
  return Array.from(groups.values()).sort((a, b) => a.householdName.localeCompare(b.householdName));
}

export function FamilyPage() {
  const user = useAuthStore((s) => s.user);
  const hydrate = useAuthStore((s) => s.hydrate);
  const [members, setMembers] = useState<User[]>([]);
  const [roleProfiles, setRoleProfiles] = useState<RoleProfile[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedProfileIds, setSelectedProfileIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editProfileIds, setEditProfileIds] = useState<number[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [toggleTarget, setToggleTarget] = useState<{ user: User; enable: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [users, profiles] = await Promise.all([api.listUsers(), api.listRoleProfiles()]);
    setMembers(users);
    setRoleProfiles(assignableProfiles(profiles));
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [load]);

  useEffect(() => {
    const childProfile = roleProfiles.find((profile) => profile.slug === "child");
    if (childProfile && selectedProfileIds.length === 0) {
      setSelectedProfileIds([childProfile.id]);
    }
  }, [roleProfiles, selectedProfileIds.length]);

  if (!user || !canManageMembers(user)) {
    return <Navigate to="/settings" replace />;
  }

  const toggleProfile = (profileId: number, selected: number[], setter: (ids: number[]) => void) => {
    setter(selected.includes(profileId) ? selected.filter((id) => id !== profileId) : [...selected, profileId]);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (selectedProfileIds.length === 0) {
      setError("Select at least one role profile");
      return;
    }
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
      setMessage("Household member added");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    }
  };

  const openEdit = (member: User) => {
    setEditing(member);
    setEditDisplayName(member.display_name);
    setEditPassword("");
    setEditProfileIds(member.role_profiles.map((profile) => profile.id));
    setError(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const trimmedName = editDisplayName.trim();
      if (!trimmedName) {
        setError("Display name is required");
        return;
      }
      if (editProfileIds.length === 0) {
        setError("Select at least one role profile");
        return;
      }
      const payload: { display_name?: string; role_profile_ids?: number[] } = {};
      if (trimmedName !== editing.display_name) payload.display_name = trimmedName;
      if (editProfileIds.join(",") !== editing.role_profiles.map((profile) => profile.id).join(",")) {
        payload.role_profile_ids = editProfileIds;
      }
      if (Object.keys(payload).length > 0) {
        await api.updateUser(editing.id, payload);
      }
      if (editPassword.trim()) {
        await api.resetPassword(editing.id, editPassword);
      }
      setEditing(null);
      setMessage(`Updated ${trimmedName}`);
      if (editing.id === user?.id) {
        await hydrate();
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update account");
    } finally {
      setBusy(false);
    }
  };

  const confirmToggleActive = async () => {
    if (!toggleTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateUser(toggleTarget.user.id, { is_active: toggleTarget.enable });
      setMessage(
        toggleTarget.enable
          ? `${toggleTarget.user.display_name} can sign in again.`
          : `${toggleTarget.user.display_name} has been disabled.`,
      );
      setToggleTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update account");
    } finally {
      setBusy(false);
    }
  };

  const confirmSoftDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.softDeleteUser(deleteTarget.id);
      setMessage(`${deleteTarget.display_name} has been removed.`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account");
    } finally {
      setBusy(false);
    }
  };

  const memberGroups = user.is_root_admin ? groupMembersByHousehold(members) : null;

  const renderMemberRow = (m: User) => (
    <div key={m.id} className={m.is_active ? "member-row" : "member-row member-row-disabled"}>
      <div>
        <div className="track-title">
          {m.display_name}
          {!m.is_active ? <span className="status-badge status-disabled">Disabled</span> : null}
        </div>
        <div className="track-subtitle">
          @{m.username} · {formatRoleProfiles(m.role_profiles)}
        </div>
      </div>
      <div className="member-actions">
        {canEditUser(user, m) ? (
          <button type="button" className="btn-secondary" onClick={() => openEdit(m)}>
            Edit
          </button>
        ) : null}
        {canToggleActive(user, m) ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setToggleTarget({ user: m, enable: !m.is_active })}
          >
            {m.is_active ? "Disable" : "Enable"}
          </button>
        ) : null}
        {canSoftDelete(user, m) ? (
          <button type="button" className="btn-danger" onClick={() => setDeleteTarget(m)}>
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="page">
      <h1>Household members</h1>
      <p className="muted">
        {user.is_root_admin
          ? "Manage household members across all households. Members are grouped by household."
          : `Manage accounts in ${user.household_name ?? "your household"}. Assign one or more role profiles to each member.`}
      </p>
      {user.is_root_admin ? (
        <Link to="/admin/users/deleted" className="accent">
          View deleted accounts →
        </Link>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="accent">{message}</p> : null}

      <form className="card" onSubmit={(e) => void create(e)}>
        <h3>Add member</h3>
        <input className="input" placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="label">Role profiles</p>
        <div className="chip-row">
          {roleProfiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={selectedProfileIds.includes(profile.id) ? "chip active" : "chip"}
              onClick={() => toggleProfile(profile.id, selectedProfileIds, setSelectedProfileIds)}
            >
              {profile.name}
              {profile.is_global ? " · default" : ""}
            </button>
          ))}
        </div>
        <button className="btn-primary" type="submit">
          Add member
        </button>
      </form>

      <h2 className="section-label">Members</h2>
      {memberGroups ? (
        memberGroups.map((group) => (
          <section key={group.key} className="household-group">
            <h3 className="household-group-title">{group.householdName}</h3>
            {group.householdSlug ? (
              <p className="muted household-group-subtitle">/h/{group.householdSlug}/login</p>
            ) : null}
            {group.members.map(renderMemberRow)}
          </section>
        ))
      ) : (
        members.map(renderMemberRow)
      )}

      {canManageParentalControls(user) ? (
        <Link to="/parental" className="accent">
          Manage parental controls →
        </Link>
      ) : null}

      {editing ? (
        <div className="modal-overlay" onClick={() => !busy && setEditing(null)}>
          <form
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit();
            }}
          >
            <h3>Edit {editing.display_name}</h3>
            <p className="muted">@{editing.username}</p>
            <input
              className="input"
              placeholder="Display name"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
            />
            <p className="label">Role profiles</p>
            <div className="chip-row">
              {roleProfiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className={editProfileIds.includes(profile.id) ? "chip active" : "chip"}
                  onClick={() => toggleProfile(profile.id, editProfileIds, setEditProfileIds)}
                >
                  {profile.name}
                </button>
              ))}
            </div>
            <input
              className="input"
              type="password"
              placeholder="New password (leave blank to keep current)"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
            />
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        visible={toggleTarget !== null}
        title={toggleTarget?.enable ? "Enable account?" : "Disable account?"}
        message={
          toggleTarget
            ? toggleTarget.enable
              ? `Re-enable "${toggleTarget.user.display_name}"?`
              : `Disable "${toggleTarget.user.display_name}"? They will not be able to sign in.`
            : ""
        }
        confirmLabel={toggleTarget?.enable ? "Enable account" : "Disable account"}
        danger={!toggleTarget?.enable}
        busy={busy}
        onConfirm={confirmToggleActive}
        onCancel={() => setToggleTarget(null)}
      />

      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Remove account?"
        message={deleteTarget ? `Remove "${deleteTarget.display_name}"? They will be signed out immediately.` : ""}
        confirmLabel="Remove account"
        danger
        busy={busy}
        onConfirm={confirmSoftDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
