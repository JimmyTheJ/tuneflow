import AsyncStorage from "@react-native-async-storage/async-storage";

const API_URL_KEY = "tuneflow.apiUrl";
const ACCESS_TOKEN_KEY = "tuneflow.accessToken";

const DEFAULT_API_URL = "http://localhost:8000";

export function normalizeApiUrl(raw: string): string {
  let url = raw.trim().replace(/\/$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url;
}

export async function hasConfiguredServer(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(API_URL_KEY);
  return stored !== null && stored.length > 0;
}

export async function getApiUrl(): Promise<string> {
  return (await AsyncStorage.getItem(API_URL_KEY)) ?? DEFAULT_API_URL;
}

export async function setApiUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(API_URL_KEY, normalizeApiUrl(url));
}

export async function getAccessToken(): Promise<string> {
  return (await AsyncStorage.getItem(ACCESS_TOKEN_KEY)) ?? "";
}

export async function setAccessToken(token: string): Promise<void> {
  await AsyncStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export async function clearAccessToken(): Promise<void> {
  await AsyncStorage.removeItem(ACCESS_TOKEN_KEY);
}
