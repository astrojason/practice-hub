import { useEffect } from "react";

/** Pressing 1-5 anywhere outside a form field sets the rating, matching the picker's own scale. */
export function useRatingKeyShortcut(setRating: (value: string) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key >= "1" && e.key <= "5") setRating(e.key);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setRating]);
}
