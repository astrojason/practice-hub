import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FIREBASE_CONFIG } from "../config";
import { createGoogleAuthUri, exchangeCallbackForTokens } from "../auth/oauth";
import {
  getStoredRefreshToken,
  storeRefreshToken,
  clearStoredRefreshToken,
  refreshIdToken,
  TokenRefreshRejectedError,
} from "../auth/tokens";

// If a refresh mid-session fails to reach the server at all (as opposed to
// reaching it and being told the token is invalid), the current idToken is
// still good for a while yet — worth one quiet extra attempt well before the
// next scheduled refresh, rather than leaving the user running on a token
// that's closer to expiry than usual.
const PROACTIVE_REFRESH_RETRY_MS = 5 * 60 * 1000;

// The redirect_uri that Firebase has registered with Google Cloud Console.
// createAuthUri passes this to Google as redirect_uri; our Tauri auth window
// intercepts the navigation before Firebase's handler page ever loads.
const AUTH_CALLBACK_URL = `https://${FIREBASE_CONFIG.authDomain}/__/auth/handler`;

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; token: string };

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredRefreshToken();
    if (stored) {
      refreshIdToken(stored)
        .then(({ idToken, refreshToken }) => {
          storeRefreshToken(refreshToken);
          setState({ status: "authenticated", token: idToken });
        })
        .catch((err) => {
          clearStoredRefreshToken();
          setAuthError(
            `Couldn't restore your previous session — please sign in again. (${err instanceof Error ? err.message : String(err)})`
          );
          setState({ status: "unauthenticated" });
        });
    } else {
      setState({ status: "unauthenticated" });
    }
  }, []);

  // Proactively refresh the token every 50 minutes (Firebase tokens expire after 1 hour)
  useEffect(() => {
    if (state.status !== "authenticated") return;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    async function attemptRefresh() {
      const stored = getStoredRefreshToken();
      if (!stored) return;
      try {
        const { idToken, refreshToken } = await refreshIdToken(stored);
        storeRefreshToken(refreshToken);
        setState({ status: "authenticated", token: idToken });
      } catch (err) {
        if (err instanceof TokenRefreshRejectedError) {
          clearStoredRefreshToken();
          setAuthError(
            `You've been signed out because your session couldn't be refreshed — please sign in again. (${err.message})`
          );
          setState({ status: "unauthenticated" });
          return;
        }
        // A network-level failure mid-session (e.g. a brief wifi drop) — the
        // current token is still valid, so keep practicing uninterrupted and
        // quietly try again soon instead of forcing a sign-out.
        retryTimeout = setTimeout(attemptRefresh, PROACTIVE_REFRESH_RETRY_MS);
      }
    }

    const interval = setInterval(attemptRefresh, 50 * 60 * 1000);
    return () => {
      clearInterval(interval);
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [state.status]);

  const signIn = useCallback(async () => {
    // 1. Ask Firebase REST API for a Google OAuth URL + session ID
    const { authUri, sessionId } = await createGoogleAuthUri(AUTH_CALLBACK_URL);

    // 2. Open a Tauri WebviewWindow; Rust monitors it and returns the callback URL
    //    once Google redirects back (before the page actually loads)
    const callbackUrl = await invoke<string>("start_auth", {
      authUri,
      continueUri: AUTH_CALLBACK_URL,
    });

    // 3. Exchange the callback URL for Firebase tokens via the REST API
    const { idToken, refreshToken } = await exchangeCallbackForTokens(
      callbackUrl,
      sessionId
    );

    storeRefreshToken(refreshToken);
    setState({ status: "authenticated", token: idToken });
  }, []);

  const signOut = useCallback(async () => {
    clearStoredRefreshToken();
    setState({ status: "unauthenticated" });
  }, []);

  return {
    isLoading: state.status === "loading",
    isAuthenticated: state.status === "authenticated",
    token: state.status === "authenticated" ? state.token : null,
    authError,
    signIn,
    signOut,
  };
}
