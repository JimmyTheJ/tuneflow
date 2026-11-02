import { getAccessToken, getApiUrl } from "./settings";

export function trackThumbnailUrl(videoId: string): string {
  if (videoId.startsWith("jf_")) {
    return `${getApiUrl()}/api/library/images/${encodeURIComponent(videoId)}?token=${encodeURIComponent(getAccessToken())}`;
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
