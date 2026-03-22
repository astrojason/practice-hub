import { useState } from "react";

interface Props {
  onSignIn: () => Promise<void>;
}

export function SignInScreen({ onSignIn }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  async function handleSignIn() {
    setError(null);
    setIsSigningIn(true);
    try {
      await onSignIn();
      // on success App transitions away — no need to reset local state
    } catch (err) {
      // Tauri invoke errors are plain strings, not Error objects
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[practice-hub] Sign-in error:", msg);
      setError(msg);
      setIsSigningIn(false);
    }
  }

  return (
    <div className="sign-in-screen">
      <h1>Practice Hub</h1>
      <p>Your daily practice companion.</p>
      <button onClick={handleSignIn} disabled={isSigningIn}>
        {isSigningIn
          ? "Opening browser — complete sign-in there…"
          : "Sign in with Google"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
