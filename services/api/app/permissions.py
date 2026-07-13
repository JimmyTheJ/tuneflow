import enum


class Permission(str, enum.Enum):
    SYSTEM_ADMIN = "system_admin"
    MANAGE_HOUSEHOLDS = "manage_households"
    MANAGE_HOUSEHOLD_MEMBERS = "manage_household_members"
    MANAGE_PARENTAL_CONTROLS = "manage_parental_controls"
    MANAGE_ROLE_PROFILES = "manage_role_profiles"
    SET_PARENT_PIN = "set_parent_pin"
    SUBJECT_TO_PARENTAL_CONTROLS = "subject_to_parental_controls"


ROOT_ADMIN_PERMISSIONS = {perm.value for perm in Permission}

DEFAULT_PROFILE_DEFINITIONS: dict[str, dict[str, object]] = {
    "parent": {
        "name": "Parent",
        "permissions": {
            Permission.MANAGE_HOUSEHOLD_MEMBERS.value,
            Permission.MANAGE_PARENTAL_CONTROLS.value,
            Permission.SET_PARENT_PIN.value,
        },
    },
    "child": {
        "name": "Child",
        "permissions": {Permission.SUBJECT_TO_PARENTAL_CONTROLS.value},
    },
    "adult": {
        "name": "Adult",
        "permissions": set(),
    },
    "household_admin": {
        "name": "Household Administrator",
        "permissions": {
            Permission.MANAGE_HOUSEHOLD_MEMBERS.value,
            Permission.MANAGE_PARENTAL_CONTROLS.value,
            Permission.MANAGE_ROLE_PROFILES.value,
            Permission.SET_PARENT_PIN.value,
        },
    },
}
