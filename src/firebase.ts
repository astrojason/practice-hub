import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
} from "firebase/auth";
import { FIREBASE_CONFIG } from "./config";

const app = initializeApp({
  apiKey: FIREBASE_CONFIG.apiKey,
  authDomain: FIREBASE_CONFIG.authDomain,
  projectId: FIREBASE_CONFIG.projectId,
});

// Use localStorage explicitly — the default (IndexedDB-first) can lose state
// in WKWebView when the WebView navigates to an external URL and back.
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});
