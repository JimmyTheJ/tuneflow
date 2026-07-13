import type { ConfigContext, ExpoConfig } from "expo/config";

// eslint-disable-next-line import/extensions
import { ensureVersionFile, getVersionCode, loadVersionName } from "./scripts/dev-build-metadata.mjs";

const baseVersion = "0.1.0";

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
    newArchEnabled: true,
    splash: {
      resizeMode: "contain",
      backgroundColor: "#0a0a0a",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.tuneflow.app",
      buildNumber: String(versionCode),
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#0a0a0a",
      },
      package: "com.tuneflow.app",
      versionCode,
      // HTTP API URLs on LAN (Expo applies this; types lag behind the schema).
      usesCleartextTraffic: true,
    } as ExpoConfig["android"],
    plugins: ["expo-router"],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      versionName,
      versionCode,
    },
  };
};
