const API_URL_KEY = "tuneflow.apiUrl";
const ACCESS_TOKEN_KEY = "tuneflow.accessToken";

const DEFAULT_API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8010";

export function getApiUrl(): string {
  return localStorage.getItem(API_URL_KEY) ?? DEFAULT_API_URL;
}

export function setApiUrl(url: string): void {
  localStorage.setItem(API_URL_KEY, url.replace(/\/$/, ""));
}

export function getAccessToken(): string {
  return localStorage.getItem(ACCESS_TOKEN_KEY) ?? "";
}

export function setAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}
