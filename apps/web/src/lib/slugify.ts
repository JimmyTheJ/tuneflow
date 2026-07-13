export function slugifyHouseholdName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "household";
}

export function normalizeHouseholdSlug(value: string): string {
  return value.trim().toLowerCase();
}
