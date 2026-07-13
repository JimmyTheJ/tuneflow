import type { PermissionName, RoleProfileSummary, User } from "@/types";

export function hasPermission(user: User | null | undefined, permission: PermissionName): boolean {
  if (!user) return false;
  if (user.is_root_admin) return true;
  return user.permissions.includes(permission);
}

export function isChildProfile(user: User | null | undefined): boolean {
  return hasPermission(user, "subject_to_parental_controls");
}

export function canManageMembers(user: User | null | undefined): boolean {
  return hasPermission(user, "manage_household_members");
}

export function canManageParentalControls(user: User | null | undefined): boolean {
  return hasPermission(user, "manage_parental_controls");
}

export function canSetParentPin(user: User | null | undefined): boolean {
  return hasPermission(user, "set_parent_pin");
}

export function canManageRoleProfiles(user: User | null | undefined): boolean {
  return hasPermission(user, "manage_role_profiles");
}

export function formatRoleProfiles(profiles: RoleProfileSummary[]): string {
  return profiles.map((profile) => profile.name).join(", ");
}

export function findRoleProfileBySlug(profiles: RoleProfileSummary[], slug: string): RoleProfileSummary | undefined {
  return profiles.find((profile) => profile.slug === slug);
}
