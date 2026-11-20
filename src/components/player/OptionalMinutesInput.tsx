import { useEffect, useState, type InputHTMLAttributes } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  /** null = unset (blank field). */
  value: number | null;
  /** Called with a number of minutes > 0 (decimals allowed), or null when the field is emptied. */
  onCommit: (v: number | null) => void;
}

/** A minutes field where blank is a valid value (meaning "no time limit"). */
export function OptionalMinutesInput({ value, onCommit, ...rest }: Props) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  useEffect(() => {
    setDraft((prev) => {
      const parsed = parseFloat(prev);
      if (value === null) return Number.isFinite(parsed) ? "" : prev;
      return parsed === value ? prev : String(value);
    });
  }, [value]);

  return (
    <input
      {...rest}
      type="number"
      min="0"
      step="any"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim() === "") { onCommit(null); return; }
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v) && v > 0) onCommit(v);
      }}
      onBlur={(e) => {
        const v = parseFloat(draft);
        if (!Number.isFinite(v) || v <= 0) {
          setDraft("");
          if (value !== null) onCommit(null);
        }
        rest.onBlur?.(e);
      }}
    />
  );
}
