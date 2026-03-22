import { FIREBASE_CONFIG } from "../config";

const FIREBASE_API_BASE = "https://identitytoolkit.googleapis.com/v1";

interface AuthUriResponse {
  authUri: string;
  sessionId: string;
}

export async function createGoogleAuthUri(
  continueUri: string
): Promise<AuthUriResponse> {
  const response = await fetch(
    `${FIREBASE_API_BASE}/accounts:createAuthUri?key=${FIREBASE_CONFIG.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "google.com", continueUri }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`createAuthUri failed: ${text}`);
  }
  return response.json() as Promise<AuthUriResponse>;
}

interface IdpTokens {
  idToken: string;
  refreshToken: string;
}

export async function exchangeCallbackForTokens(
  callbackUrl: string,
  sessionId: string
): Promise<IdpTokens> {
  const response = await fetch(
    `${FIREBASE_API_BASE}/accounts:signInWithIdp?key=${FIREBASE_CONFIG.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestUri: callbackUrl,
        sessionId,
        returnSecureToken: true,
      }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`signInWithIdp failed: ${text}`);
  }
  const data = (await response.json()) as {
    idToken: string;
    refreshToken: string;
  };
  return { idToken: data.idToken, refreshToken: data.refreshToken };
}
