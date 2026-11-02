const API_URL_KEY = "tuneflow.apiUrl";
const ACCESS_TOKEN_KEY = "tuneflow.accessToken";

const DEV_PROXY_API_URLS = new Set([
  "http://localhost:8010",
  "http://127.0.0.1:8010",
]);

export function getApiUrl(): string {
  const stored = localStorage.getItem(API_URL_KEY);
  const defaultUrl = import.meta.env.VITE_API_URL ?? "";
  if (stored && DEV_PROXY_API_URLS.has(stored) && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    localStorage.removeItem(API_URL_KEY);
    return defaultUrl;
  }
  if (import.meta.env.DEV && stored && DEV_PROXY_API_URLS.has(stored)) {
    return "";
  }
  return stored ?? defaultUrl;
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
