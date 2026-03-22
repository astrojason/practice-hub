import { useAuth } from "./hooks/useAuth";
import { SignInScreen } from "./components/SignInScreen";
import { SessionView } from "./components/SessionView";

export function App() {
  const { isLoading, isAuthenticated, token, signIn, signOut } = useAuth();

  if (isLoading) {
    return (
      <div className="loading-screen">
        <p>Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated || !token) {
    return <SignInScreen onSignIn={signIn} />;
  }

  return <SessionView token={token} onSignOut={signOut} />;
}
