import { useEffect, useState, type InputHTMLAttributes } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  /** Minutes (decimals allowed); null = unset (blank field). */
  value: number | null;
  /** Called with a number of minutes > 0, or null when the field is emptied. */
  onCommit: (v: number | null) => void;
}

/**
 * Reads a time limit typed as minutes ("6", "1.5"), minutes and seconds ("6:30")
 * or seconds ("90s"). Returns minutes, null for blank, undefined when it isn't a time (yet).
 */
export function parseMinutes(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  let minutes: number;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+):([0-5]?\d)$/.exec(t))) minutes = parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
  else if ((m = /^(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?$/i.exec(t))) minutes = parseFloat(m[1]) / 60;
  else if ((m = /^(\d+(?:\.\d+)?)\s*(?:m|min)?$/i.exec(t))) minutes = parseFloat(m[1]);
  else return undefined;
  return minutes > 0 ? minutes : undefined;
}

/** Whole minutes as "6", anything with seconds as "6:30". */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes * 60);
  if (Math.abs(total - minutes * 60) > 0.01 && total % 60 !== 0) return String(minutes);
  return total % 60 === 0 ? String(total / 60) : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** A time-limit field where blank is a valid value (meaning "no limit"); takes minutes, m:ss or seconds. */
export function OptionalMinutesInput({ value, onCommit, ...rest }: Props) {
  const [draft, setDraft] = useState(value === null ? "" : formatMinutes(value));
  // Text that isn't a time is left in the field and marked, not quietly dropped.
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft((prev) => {
      const parsed = parseMinutes(prev);
      if (value === null) return typeof parsed === "number" ? "" : prev;
      return parsed !== undefined && parsed !== null && Math.abs(parsed - value) < 1e-9 ? prev : formatMinutes(value);
    });
  }, [value]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="text"
      autoComplete="off"
      value={draft}
      aria-invalid={invalid || undefined}
      className={`${rest.className ?? ""}${invalid ? " is-invalid" : ""}`}
      title={invalid ? "Not a time: use minutes (6), minutes:seconds (6:30) or seconds (90s). The previous limit is still in effect." : rest.title}
      onChange={(e) => {
        setDraft(e.target.value);
        setInvalid(false);
        const v = parseMinutes(e.target.value);
        if (v === null) onCommit(null);
        else if (v !== undefined) onCommit(v);
      }}
      onBlur={(e) => {
        const v = parseMinutes(draft);
        if (v === undefined) setInvalid(true);
        else if (v === null && value !== null) onCommit(null);
        rest.onBlur?.(e);
      }}
    />
  );
}
