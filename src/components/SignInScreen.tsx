import { useEffect, useState } from "react";
import { ErrorModal } from "./ErrorModal";

interface Props {
  onSignIn: () => Promise<void>;
  onSignInWithPassword: (email: string, password: string) => Promise<void>;
  onCreateAccount: (email: string, password: string) => Promise<void>;
  restoreError?: string | null;
}

type Mode = "google" | "signin" | "create";

export function SignInScreen({ onSignIn, onSignInWithPassword, onCreateAccount, restoreError }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("google");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (restoreError) setError(restoreError);
  }, [restoreError]);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      // on success App transitions away — no need to reset local state
    } catch (err) {
      // Tauri invoke errors are plain strings, not Error objects
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "create") {
      if (password !== confirm) {
        setError("The two passwords don't match.");
        return;
      }
      void run(() => onCreateAccount(email.trim(), password));
    } else {
      void run(() => onSignInWithPassword(email.trim(), password));
    }
  }

  return (
    <div className="sign-in-screen">
      <h1>Practice Hub</h1>
      <p>Your daily practice companion.</p>

      {mode === "google" ? (
        <>
          <button onClick={() => run(onSignIn)} disabled={busy}>
            {busy ? "Opening browser — complete sign-in there…" : "Sign in with Google"}
          </button>
          <div className="sign-in-alt">
            <button className="btn-ghost" onClick={() => setMode("signin")}>Sign in with email</button>
            <button className="btn-ghost" onClick={() => setMode("create")}>Create an account</button>
          </div>
        </>
      ) : (
        <form className="sign-in-form" onSubmit={submit}>
          <h2>{mode === "create" ? "Create an account" : "Sign in with email"}</h2>
          <label>
            Email
            <input type="email" aria-label="Email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              aria-label="Password"
              autoComplete={mode === "create" ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {mode === "create" && (
            <label>
              Confirm password
              <input type="password" aria-label="Confirm password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "create" ? "Create account" : "Sign in"}
          </button>
          <div className="sign-in-alt">
            {mode === "create" ? (
              <button type="button" className="btn-ghost" onClick={() => setMode("signin")}>I already have an account</button>
            ) : (
              <button type="button" className="btn-ghost" onClick={() => setMode("create")}>Create an account</button>
            )}
            <button type="button" className="btn-ghost" onClick={() => setMode("google")}>Sign in with Google</button>
          </div>
        </form>
      )}
      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
    </div>
  );
}
