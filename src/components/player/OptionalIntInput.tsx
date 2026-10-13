import { useEffect, useState, type InputHTMLAttributes } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  /** null = unset (blank field). */
  value: number | null;
  /** Called with a whole number >= 1, or null when the field is emptied. */
  onCommit: (v: number | null) => void;
}

/** A whole-number field where blank is a valid value (meaning "not set"). */
export function OptionalIntInput({ value, onCommit, ...rest }: Props) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  useEffect(() => {
    setDraft((prev) => {
      const parsed = parseInt(prev, 10);
      if (value === null) return Number.isFinite(parsed) ? "" : prev;
      return parsed === value ? prev : String(value);
    });
  }, [value]);

  return (
    <input
      {...rest}
      type="number"
      min="1"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim() === "") { onCommit(null); return; }
        const v = parseInt(e.target.value, 10);
        if (Number.isFinite(v) && v >= 1) onCommit(v);
      }}
      onBlur={(e) => {
        const v = parseInt(draft, 10);
        if (!Number.isFinite(v) || v < 1) {
          setDraft("");
          if (value !== null) onCommit(null);
        } else {
          setDraft(String(v));
        }
        rest.onBlur?.(e);
      }}
    />
  );
}
