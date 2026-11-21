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
      // identifier is required by the API even for OAuth providers;
      // it's used as login_hint but doesn't restrict which account signs in.
      body: JSON.stringify({
        providerId: "google.com",
        continueUri,
        identifier: "placeholder@placeholder.com",
      }),
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

// ─── Email and password (create an account, or sign in without Google) ───────

const EMAIL_ERRORS: Record<string, string> = {
  EMAIL_EXISTS: "An account with this email already exists. Sign in instead.",
  INVALID_EMAIL: "That doesn't look like a valid email address.",
  WEAK_PASSWORD: "That password is too weak: use at least 6 characters.",
  INVALID_LOGIN_CREDENTIALS: "The email or password is wrong.",
  INVALID_PASSWORD: "The email or password is wrong.",
  EMAIL_NOT_FOUND: "The email or password is wrong.",
  USER_DISABLED: "This account has been disabled.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts. Wait a few minutes and try again.",
  OPERATION_NOT_ALLOWED: "Signing in with an email and password isn't turned on for this app yet.",
};

async function emailRequest(endpoint: "accounts:signUp" | "accounts:signInWithPassword", email: string, password: string): Promise<IdpTokens> {
  const response = await fetch(`${FIREBASE_API_BASE}/${endpoint}?key=${FIREBASE_CONFIG.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!response.ok) {
    const text = await response.text();
    let code = "";
    try {
      code = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      // Not JSON: the raw text below says what came back.
    }
    const key = code.split(" ")[0];
    throw new Error(EMAIL_ERRORS[key] ? `${EMAIL_ERRORS[key]} (${code})` : `${endpoint} failed: ${text}`);
  }
  const data = (await response.json()) as { idToken: string; refreshToken: string };
  return { idToken: data.idToken, refreshToken: data.refreshToken };
}

/** Create a new Instrumenta account with an email and password. */
export const signUpWithEmail = (email: string, password: string) => emailRequest("accounts:signUp", email, password);

/** Sign in to an existing account with an email and password. */
export const signInWithEmail = (email: string, password: string) => emailRequest("accounts:signInWithPassword", email, password);
