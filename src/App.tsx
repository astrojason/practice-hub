import { useRef, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "./hooks/useAuth";
import { SignInScreen } from "./components/SignInScreen";
import { SessionView } from "./components/SessionView";
import { GpLibraryView } from "./components/GpLibraryView";
import { InterleavedCalendarView } from "./components/InterleavedCalendarView";
import { BrowseView } from "./components/BrowseView";
import { Changelog } from "./components/Changelog";
import { SettingsView } from "./components/SettingsView";
import { ErrorModal } from "./components/ErrorModal";
import pkgJson from "../package.json";

const APP_VERSION: string = pkgJson.version;

type AppView = "session" | "gp-library" | "calendar" | "browse" | "changelog" | "settings";

const MUSIC_QUOTES = [
  { text: "Without music, life would be a mistake.", author: "Nietzsche" },
  { text: "One good thing about music, when it hits you, you feel no pain.", author: "Bob Marley" },
  { text: "Where words fail, music speaks.", author: "Hans Christian Andersen" },
  { text: "Music expresses that which cannot be put into words.", author: "Victor Hugo" },
  { text: "If music be the food of love, play on.", author: "Shakespeare" },
  { text: "Music is the shorthand of emotion.", author: "Tolstoy" },
  { text: "After silence, music comes nearest to expressing the inexpressible.", author: "Aldous Huxley" },
  { text: "Music is the wine that fills the cup of silence.", author: "Robert Fripp" },
];

export function App() {
  const { isLoading, isAuthenticated, token, authError, signIn, signOut } = useAuth();
  const quoteRef = useRef(MUSIC_QUOTES[Math.floor(Math.random() * MUSIC_QUOTES.length)]);
  const [slowLoad, setSlowLoad] = useState(false);
  const [view, setView] = useState<AppView>("session");
  const [gpOpenError, setGpOpenError] = useState<string | null>(null);

  // Guitar Pro files open in the real Guitar Pro app (via the OS's default
  // file-type handler) rather than an in-app viewer.
  function openGpFile(path: string) {
    invoke("open_with_default", { path }).catch((err) =>
      setGpOpenError(err instanceof Error ? err.message : String(err))
    );
  }

  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => setSlowLoad(true), 5000);
    return () => clearTimeout(t);
  }, [isLoading]);

  if (isLoading) {
    const quote = quoteRef.current;
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <blockquote className="loading-quote">
          <p>"{quote.text}"</p>
          <footer>— {quote.author}</footer>
        </blockquote>
        {slowLoad && (
          <p className="loading-slow">Still connecting… check your network if this persists.</p>
        )}
      </div>
    );
  }

  if (!isAuthenticated || !token) {
    return <SignInScreen onSignIn={signIn} restoreError={authError} />;
  }

  let overlay = null;
  if (view === "gp-library") {
    overlay = <GpLibraryView token={token} onBack={() => setView("session")} />;
  } else if (view === "calendar") {
    overlay = <InterleavedCalendarView token={token} onBack={() => setView("session")} />;
  } else if (view === "browse") {
    overlay = <BrowseView token={token} onBack={() => setView("session")} />;
  } else if (view === "changelog") {
    overlay = <Changelog onBack={() => setView("session")} />;
  } else if (view === "settings") {
    overlay = <SettingsView onBack={() => setView("session")} />;
  }

  return (
    <>
      {/* Stays mounted across navigation so switching views doesn't re-fetch the
          dashboard or reset in-progress timers — only visibility toggles. */}
      <div style={{ display: view === "session" ? "contents" : "none" }}>
        <SessionView
          token={token}
          onSignOut={signOut}
          onGpLibrary={() => setView("gp-library")}
          onCalendar={() => setView("calendar")}
          onBrowse={() => setView("browse")}
          onChangelog={() => setView("changelog")}
          onSettings={() => setView("settings")}
          onGpView={openGpFile}
        />
      </div>
      {overlay}
      {gpOpenError && <ErrorModal error={gpOpenError} onDismiss={() => setGpOpenError(null)} />}
      <button
        className="app-version-footer"
        onClick={() => setView("changelog")}
        title="View changelog"
      >
        v{APP_VERSION}
      </button>
    </>
  );
}
