import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FIREBASE_CONFIG } from "../config";
import { createGoogleAuthUri, exchangeCallbackForTokens } from "../auth/oauth";
import {
  getStoredRefreshToken,
  storeRefreshToken,
  clearStoredRefreshToken,
  refreshIdToken,
} from "../auth/tokens";

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

  useEffect(() => {
    const stored = getStoredRefreshToken();
    if (stored) {
      refreshIdToken(stored)
        .then(({ idToken, refreshToken }) => {
          storeRefreshToken(refreshToken);
          setState({ status: "authenticated", token: idToken });
        })
        .catch((err) => {
          console.error("[auth] Session restore failed:", err);
          clearStoredRefreshToken();
          setState({ status: "unauthenticated" });
        });
    } else {
      setState({ status: "unauthenticated" });
    }
  }, []);

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
    signIn,
    signOut,
  };
}
