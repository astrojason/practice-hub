import { useRef, useEffect, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { SignInScreen } from "./components/SignInScreen";
import { SessionView } from "./components/SessionView";

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
  const { isLoading, isAuthenticated, token, signIn, signOut } = useAuth();
  const quoteRef = useRef(MUSIC_QUOTES[Math.floor(Math.random() * MUSIC_QUOTES.length)]);
  const [slowLoad, setSlowLoad] = useState(false);

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
    return <SignInScreen onSignIn={signIn} />;
  }

  return <SessionView token={token} onSignOut={signOut} />;
}
