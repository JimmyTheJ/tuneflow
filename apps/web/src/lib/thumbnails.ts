export function trackThumbnailUrl(videoId: string): string {
  if (videoId.startsWith("jf_")) return "";
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
