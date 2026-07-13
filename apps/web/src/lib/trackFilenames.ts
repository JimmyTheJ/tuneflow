const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_BASE_LENGTH = 180;

export function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(INVALID_FILENAME_CHARS, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
}

export function buildTrackBaseName(
  title: string,
  options?: { artist?: string | null; position?: number },
): string {
  const parts: string[] = [];
  if (options?.position != null) {
    parts.push(String(options.position).padStart(2, "0"));
  }
  if (options?.artist) {
    const artist = sanitizeFilenamePart(options.artist);
    if (artist) parts.push(artist);
  }
  parts.push(sanitizeFilenamePart(title) || "track");
  const base = parts.join(" - ");
  return base.length > MAX_BASE_LENGTH ? base.slice(0, MAX_BASE_LENGTH).replace(/[\s.]+$/, "") : base;
}

export function extensionFromMime(mimeType: string | null | undefined): string {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("opus")) return ".opus";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("aac")) return ".aac";
  return ".m4a";
}

export function uniqueFilename(baseName: string, extension: string, used: Set<string>): string {
  let candidate = `${baseName}${extension}`;
  if (!used.has(candidate.toLowerCase())) {
    used.add(candidate.toLowerCase());
    return candidate;
  }

  let suffix = 2;
  while (used.has(`${baseName} (${suffix})${extension}`.toLowerCase())) {
    suffix += 1;
  }
  candidate = `${baseName} (${suffix})${extension}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function sanitizeDirectoryName(name: string): string {
  const cleaned = sanitizeFilenamePart(name);
  return cleaned || "playlist";
}
