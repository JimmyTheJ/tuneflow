import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Local dev build versioning under `%USERPROFILE%\.tuneflow-mobile-dev\` (not in git).
 *
 * - version.properties: version used for the next dev APK build (auto-incremented after each build)
 * - last-build.properties: metadata for the most recently produced dev APK
 */
export const DIR_NAME = ".tuneflow-mobile-dev";
export const ANDROID_SDK_DIR_NAME = ".tuneflow-android-sdk";
export const VERSION_FILE = "version.properties";
export const LAST_BUILD_FILE = "last-build.properties";
export const INITIAL_DEV_VERSION = "0.1.0-dev.1";

export function userDir() {
  return path.join(os.homedir(), DIR_NAME);
}

export function userAndroidSdkDir() {
  return path.join(os.homedir(), ANDROID_SDK_DIR_NAME);
}

export function versionFilePath() {
  return path.join(userDir(), VERSION_FILE);
}

export function lastBuildFilePath() {
  return path.join(userDir(), LAST_BUILD_FILE);
}

function loadProperties(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  const props = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    props[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return props;
}

function writeProperties(filePath, props, comment) {
  const lines = [`#${comment}`, ...Object.entries(props).map(([key, value]) => `${key}=${value}`)];
  fs.writeFileSync(filePath, `${lines.join(os.EOL)}${os.EOL}`, "utf8");
}

export function loadVersionName() {
  const props = loadProperties(versionFilePath());
  const versionName = props?.versionName?.replace(/^v/, "");
  return versionName || null;
}

export function ensureVersionFile(versionName = INITIAL_DEV_VERSION) {
  if (fs.existsSync(versionFilePath())) {
    return loadVersionName() ?? versionName;
  }
  fs.mkdirSync(userDir(), { recursive: true });
  writeVersionName(versionName);
  return versionName;
}

export function writeVersionName(versionName) {
  fs.mkdirSync(userDir(), { recursive: true });
  writeProperties(versionFilePath(), { versionName }, "Local dev APK version for tuneflow-mobile (not in git)");
}

/**
 * `0.1.0-dev.2` -> `0.1.0-dev.3`; appends `-dev.1` when no dev suffix exists.
 */
export function bumpDevVersion(versionName) {
  const match = /^(.*-dev\.)(\d+)$/.exec(versionName);
  if (!match) return `${versionName}-dev.1`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

/**
 * Maps a semantic version to Android versionCode (same scheme as jellyfin-android).
 */
export function getVersionCode(versionName) {
  const dashIndex = versionName.indexOf("-");
  const versionCore = dashIndex === -1 ? versionName : versionName.slice(0, dashIndex);
  const versionPreRelease = dashIndex === -1 ? null : versionName.slice(dashIndex + 1);

  const [major = 0, minor = 0, patch = 0] = versionCore
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part))
    .slice(0, 3);

  const buildVersion = versionPreRelease?.includes(".")
    ? Number.parseInt(versionPreRelease.slice(versionPreRelease.lastIndexOf(".") + 1), 10)
    : Number.NaN;

  let code = 0;
  code += major * 1_000_000;
  code += minor * 10_000;
  code += patch * 100;
  code += Number.isFinite(buildVersion) ? buildVersion : 99;
  return code;
}

export function recordDevBuild({ versionName, versionCode, apkPath, variant = "debug" }) {
  fs.mkdirSync(userDir(), { recursive: true });

  const gitCommit = (() => {
    try {
      return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  })();

  const builtAt = new Date().toISOString();
  const apkFileName = path.basename(apkPath);

  writeProperties(
    lastBuildFilePath(),
    {
      versionName,
      versionCode: String(versionCode),
      apkFileName,
      apkPath,
      variant,
      gitCommit,
      builtAt,
    },
    "Last tuneflow-mobile dev APK build",
  );

  const nextVersion = bumpDevVersion(versionName);
  writeVersionName(nextVersion);

  return {
    versionName,
    versionCode,
    apkPath,
    variant,
    gitCommit,
    builtAt,
    nextVersion,
  };
}
