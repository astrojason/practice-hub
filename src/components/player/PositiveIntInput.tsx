import { useEffect, useState, type InputHTMLAttributes } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number;
  /** Called with each valid (whole, ≥ 1) number as it's typed. */
  onCommit: (v: number) => void;
}

/**
 * A whole-number field that can be emptied while typing. Binding a number input
 * straight to `parseInt(text) || fallback` snaps a cleared field back to the
 * fallback, so typing "1" after clearing "3" yields "13". This keeps the text
 * as a draft, commits only valid numbers, and restores the last valid value on blur.
 */
export function PositiveIntInput({ value, onCommit, ...rest }: Props) {
  const [draft, setDraft] = useState(String(value));

  // Follow outside changes (applying a region, loading a preset) but not our own typing.
  useEffect(() => {
    setDraft((prev) => (parseInt(prev, 10) === value ? prev : String(value)));
  }, [value]);

  return (
    <input
      {...rest}
      type="number"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = parseInt(e.target.value, 10);
        if (Number.isFinite(v) && v >= 1) onCommit(v);
      }}
      onBlur={(e) => {
        setDraft(String(value));
        rest.onBlur?.(e);
      }}
    />
  );
}
