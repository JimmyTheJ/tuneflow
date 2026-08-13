/**
 * react-native-track-player opens the app with
 * trackplayer://notification.click when the media notification is tapped.
 * Expo Router would otherwise treat that as a missing route ("Unmatched").
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    const url = new URL(path, "tuneflow://");
    if (
      url.hostname === "notification.click" ||
      url.host === "notification.click" ||
      path.includes("notification.click")
    ) {
      return "/player";
    }
    return path;
  } catch {
    if (path.includes("notification.click")) {
      return "/player";
    }
    return path;
  }
}
