import { useEffect, useState, type InputHTMLAttributes } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number;
  /** Called with each valid whole number in range as it's typed, and with the clamped value on blur. */
  onCommit: (v: number) => void;
  /** Smallest accepted value (default 1). */
  clampMin?: number;
  /** Largest accepted value (default: unbounded). */
  clampMax?: number;
}

/**
 * A whole-number field that can be emptied while typing. Binding a number input
 * straight to `parseInt(text) || fallback` (or clamping on every keystroke)
 * fights the user: clearing "3" snaps back to the fallback, so typing "1" yields
 * "13", and typing "90" into a 40–260 field jams to 40 at the first "9". This
 * keeps the text as a draft, commits only in-range numbers while typing, clamps
 * an out-of-range number on blur, and restores the last valid value if left empty.
 */
export function PositiveIntInput({ value, onCommit, clampMin = 1, clampMax, ...rest }: Props) {
  const [draft, setDraft] = useState(String(value));

  // Follow outside changes (applying a region, loading a preset) but not our own typing.
  useEffect(() => {
    setDraft((prev) => (parseInt(prev, 10) === value ? prev : String(value)));
  }, [value]);

  const inRange = (v: number) => v >= clampMin && (clampMax === undefined || v <= clampMax);

  return (
    <input
      {...rest}
      type="number"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = parseInt(e.target.value, 10);
        if (Number.isFinite(v) && inRange(v)) onCommit(v);
      }}
      onBlur={(e) => {
        const v = parseInt(draft, 10);
        if (Number.isFinite(v)) {
          const clamped = Math.max(clampMin, clampMax === undefined ? v : Math.min(clampMax, v));
          setDraft(String(clamped));
          if (clamped !== value) onCommit(clamped);
        } else {
          setDraft(String(value));
        }
        rest.onBlur?.(e);
      }}
    />
  );
}
