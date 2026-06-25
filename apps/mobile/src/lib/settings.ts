import AsyncStorage from "@react-native-async-storage/async-storage";

const API_URL_KEY = "tuneflow.apiUrl";
const API_TOKEN_KEY = "tuneflow.apiToken";

const DEFAULT_API_URL = "http://localhost:8000";

export async function getApiUrl(): Promise<string> {
  return (await AsyncStorage.getItem(API_URL_KEY)) ?? DEFAULT_API_URL;
}

export async function setApiUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(API_URL_KEY, url.replace(/\/$/, ""));
}

export async function getApiToken(): Promise<string> {
  return (await AsyncStorage.getItem(API_TOKEN_KEY)) ?? "";
}

export async function setApiToken(token: string): Promise<void> {
  await AsyncStorage.setItem(API_TOKEN_KEY, token);
}
