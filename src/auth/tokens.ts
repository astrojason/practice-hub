import { FIREBASE_CONFIG } from "../config";
import { fetchWithRetry } from "../api/fetchWithRetry";

const REFRESH_TOKEN_KEY = "ph:refreshToken";

// Thrown only when the server actually responded and rejected the refresh
// token (e.g. revoked/expired) — as opposed to a network-level failure,
// where fetchWithRetry's own error (unwrapped) propagates instead. Callers
// use this distinction to tell "you're really signed out" apart from "we
// couldn't reach the server right now".
export class TokenRefreshRejectedError extends Error {}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function storeRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

export function clearStoredRefreshToken(): void {
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export async function refreshIdToken(
  refreshToken: string
): Promise<{ idToken: string; refreshToken: string }> {
  const response = await fetchWithRetry(
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new TokenRefreshRejectedError(`Token refresh failed: ${text}`);
  }
  const data = (await response.json()) as {
    id_token: string;
    refresh_token: string;
  };
  return { idToken: data.id_token, refreshToken: data.refresh_token };
}
