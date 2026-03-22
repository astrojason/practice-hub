import { FIREBASE_CONFIG } from "../config";

const REFRESH_TOKEN_KEY = "ph:refreshToken";

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
  const response = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${text}`);
  }
  const data = (await response.json()) as {
    id_token: string;
    refresh_token: string;
  };
  return { idToken: data.id_token, refreshToken: data.refresh_token };
}
