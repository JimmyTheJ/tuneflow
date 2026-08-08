import type { ConfigContext, ExpoConfig } from "expo/config";

// eslint-disable-next-line import/extensions
import { ensureVersionFile, getVersionCode, loadVersionName } from "./scripts/dev-build-metadata.mjs";

const baseVersion = "0.1.0";
const defaultNdkVersion = "27.2.12479018";

export default ({ config }: ConfigContext): ExpoConfig => {
  const devBuildRequested = process.env.TUNEFLOW_DEV_BUILD === "1";
  const versionName = devBuildRequested ? ensureVersionFile(`${baseVersion}-dev.1`) : loadVersionName() ?? baseVersion;
  const versionCode = getVersionCode(versionName);

  return {
    ...config,
    name: "Tuneflow",
    slug: "tuneflow",
    version: versionName,
    orientation: "portrait",
    scheme: "tuneflow",
    userInterfaceStyle: "dark",
    newArchEnabled: process.env.TUNEFLOW_DEV_BUILD === "1" ? false : true,
    splash: {
      resizeMode: "contain",
      backgroundColor: "#0a0a0a",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.tuneflow.app",
      buildNumber: String(versionCode),
      infoPlist: {
        UIBackgroundModes: ["audio"],
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#0a0a0a",
      },
      package: "com.tuneflow.app",
      versionCode,
      permissions: [
        "WAKE_LOCK",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_MEDIA_PLAYBACK",
        "POST_NOTIFICATIONS",
      ],
    },
    plugins: [
      "expo-router",
      "expo-font",
      [
        "expo-build-properties",
        {
          android: {
            ndkVersion: defaultNdkVersion,
            usesCleartextTraffic: true,
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      versionName,
      versionCode,
    },
  };
};
