import { degreeColour } from "../../lib/fretboard/schemes";
import { SCALES, degreeNumber, intervalName, isAltered, plainName, spell, type Tone } from "../../lib/fretboard/theory";

const family = (label: string) => ((degreeNumber(label) - 1) % 7) + 1;
const rlabel = (label: string) => (label === "1" ? "R" : label);
const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Every note of a scale or chord as a coloured chip: click to hear it. */
export function ToneChips({ tones, root, scheme, onHear }: { tones: Tone[]; root: number; scheme: number; onHear: (semis: number, label: string) => void }) {
  return (
    <div className="fb-tone-chips">
      {tones.map((t) => {
        const c = degreeColour(scheme, family(t.label), isAltered(t.label));
        const note = spell(root, t.semis, t.label);
        return (
          <button
            key={`${t.semis}-${t.label}`}
            className="fb-tone-chip"
            style={{ background: c.fill, color: c.text }}
            title={`${intervalName(t.label)} — ${note}  (click to hear)`}
            onClick={() => onHear(t.semis, t.label)}
          >
            {t.label}  {note}
          </button>
        );
      })}
    </div>
  );
}

/** The steps between the notes of a scale: W, H, W+H. */
export function StepsLine({ tones }: { tones: Tone[] }) {
  const steps = tones.map((t, i) => {
    const next = tones[i + 1]?.semis ?? 12;
    const d = next - t.semis;
    return d === 1 ? "H" : d === 2 ? "W" : d === 3 ? "W+H" : String(d);
  });
  return <p className="fb-steps fb-dim">Steps: {steps.join(" – ")}</p>;
}

/** What the marks mean when two scales are blended. */
export function BlendLegend({ a, b }: { a: string; b: string }) {
  const col = "rgb(130, 150, 200)";
  return (
    <div className="fb-blend-legend">
      <div>
        <svg width="26" height="22" aria-hidden="true"><circle cx="13" cy="11" r="8" fill={col} /></svg>
        <span>In both scales</span>
      </div>
      <div>
        <svg width="26" height="22" aria-hidden="true"><circle cx="13" cy="11" r="10" fill="none" stroke="#2dd4bf" strokeWidth="2.5" /><circle cx="13" cy="11" r="7" fill={col} /></svg>
        <span>Only in {a}</span>
      </div>
      <div>
        <svg width="26" height="22" aria-hidden="true"><rect x="5" y="3" width="16" height="16" transform="rotate(45 13 11)" fill={col} stroke="var(--surface)" strokeWidth="1.5" /></svg>
        <span>Only in {b}</span>
      </div>
    </div>
  );
}

interface StripProps {
  tones: Tone[];
  root: number;
  scheme: number;
  /** Degree changes from major or natural minor: [text, direction]. */
  changes: [string, number][];
  /** Half steps (above the root) that belong to the chord sounding now. */
  chordSemis: number[];
  /** Half steps (above the root) of the note that just played. */
  litSemis: number | null;
  blendSrc: [number, number][] | null;
  onHear: (semis: number) => void;
}

/** One octave from the root, every half step: which belong to the scale, and their degrees. */
export function DegreeStrip({ tones, root, scheme, changes, chordSemis, litSemis, blendSrc, onHear }: StripProps) {
  const marked = new Map<number, number>();
  for (const [text, dir] of changes) {
    if (dir === 0) continue;
    const label = text.replace(/^\+/, "").replace(/^natural /, "");
    const t = tones.find((x) => x.label === label);
    if (t) marked.set(mod(t.semis, 12), dir);
  }
  return (
    <div className="fb-degree-strip" role="group" aria-label="One octave from the root">
      <span className="fb-dim fb-degree-strip__title">One octave from the root — every half step</span>
      <div className="fb-degree-strip__cells">
        {Array.from({ length: 13 }, (_, i) => {
          const semis = i % 12;
          const tone = tones.find((t) => mod(t.semis, 12) === semis);
          const dir = i < 12 ? marked.get(semis) : undefined;
          const src = blendSrc?.find((e) => e[0] === semis)?.[1];
          if (!tone) {
            return (
              <button key={i} className="fb-strip-cell" onClick={() => onHear(i)} title="Click to hear">
                <span className="fb-strip-cell__note">{plainName(root + semis)}</span>
              </button>
            );
          }
          const c = degreeColour(scheme, family(tone.label), isAltered(tone.label));
          return (
            <button
              key={i}
              className={`fb-strip-cell fb-strip-cell--in ${litSemis === semis ? "fb-strip-cell--lit" : ""} ${chordSemis.includes(semis) ? "fb-strip-cell--chord" : ""} ${src === 1 ? "fb-strip-cell--first" : ""} ${src === 2 ? "fb-strip-cell--second" : ""}`}
              style={{ background: c.fill, color: c.text }}
              onClick={() => onHear(i)}
              title="Click to hear"
            >
              <span className="fb-strip-cell__deg">{rlabel(tone.label)}</span>
              <span className="fb-strip-cell__note">{spell(root, tone.semis, tone.label)}</span>
              {dir !== undefined && <span className="fb-strip-marker" aria-label={dir > 0 ? "raised" : "lowered"}>{dir > 0 ? "▲" : "▼"}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface CircleProps {
  tones: Tone[];
  root: number;
  scheme: number;
  chordSemis: number[];
  litSemis: number | null;
  blendSrc: [number, number][] | null;
}

/** The 12 notes round a circle, with the scale (and the chord sounding) drawn as shapes. */
export function DegreeCircle({ tones, root, scheme, chordSemis, litSemis, blendSrc }: CircleProps) {
  const size = 220;
  const c = size / 2;
  const rad = 82;
  const at = (semis: number): [number, number] => {
    const a = -Math.PI / 2 + (mod(semis, 12) / 12) * Math.PI * 2;
    return [c + Math.cos(a) * rad, c + Math.sin(a) * rad];
  };
  const inScale = [...new Set(tones.map((t) => mod(t.semis, 12)))].sort((a, b) => a - b);
  const poly = (list: number[]) => list.map((s) => at(s).join(",")).join(" ");
  const chord = [...new Set(chordSemis.map((s) => mod(s, 12)))].sort((a, b) => a - b);
  return (
    <svg className="fb-circle" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="The 12 notes round a circle">
      <circle cx={c} cy={c} r={rad + 26} className="fb-circle__bg" />
      <circle cx={c} cy={c} r={rad} className="fb-circle__ring" />
      {inScale.length >= 3 && <polygon className="fb-circle__scale" points={poly(inScale)} />}
      {chord.length >= 3 && <polygon className="fb-circle__chord" points={poly(chord)} />}
      {Array.from({ length: 12 }, (_, semis) => {
        const [x, y] = at(semis);
        const tone = tones.find((t) => mod(t.semis, 12) === semis);
        if (!tone) {
          return (
            <g key={semis} className="fb-circle__node">
              <circle cx={x} cy={y} r={4} className="fb-circle__dot" />
            </g>
          );
        }
        const col = degreeColour(scheme, family(tone.label), isAltered(tone.label));
        const src = blendSrc?.find((e) => e[0] === semis)?.[1];
        const r = tone.label === "1" ? 17 : 14;
        return (
          <g key={semis} className={`fb-circle__node fb-circle__node--in ${litSemis === semis ? "fb-circle__node--lit" : ""}`}>
            {litSemis === semis && <circle cx={x} cy={y} r={r + 6} fill={col.fill} opacity={0.35} />}
            {src === 1 && <circle cx={x} cy={y} r={r + 3.5} fill="none" stroke="#2dd4bf" strokeWidth={2.5} />}
            {tone.label === "1" && <circle cx={x} cy={y} r={r + 2.5} fill="#fff" />}
            {src === 2 ? (
              <rect x={x - r} y={y - r} width={r * 2} height={r * 2} transform={`rotate(45 ${x} ${y})`} fill={col.fill} />
            ) : (
              <circle cx={x} cy={y} r={r} fill={col.fill} />
            )}
            <text x={x} y={y - 1} textAnchor="middle" fill={col.text} fontSize="11" fontWeight="700">{rlabel(tone.label)}</text>
            <text x={x} y={y + 9} textAnchor="middle" fill={col.text} fontSize="8">{spell(root, tone.semis, tone.label)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** The tonality badge and each change from the natural major or minor scale. */
export function TonalityRow({ tonality, parent, changes }: { tonality: string; parent: string; changes: [string, number][] }) {
  const cls = tonality === "Major" ? "major" : tonality === "Minor" ? "minor" : "other";
  const real = changes.filter(([, d]) => d !== 0 || true);
  return (
    <div className="fb-tonality-row">
      <span className={`fb-tonality-badge fb-tonality-badge--${cls}`}>{tonality} tonality</span>
      {changes.length === 0 ? (
        <span className="fb-dim">= the natural {parent.toLowerCase().replace("natural ", "")} scale</span>
      ) : (
        <>
          <span className="fb-dim">= {parent} with</span>
          {real.map(([text, dir]) => (
            <span key={text} className={`fb-change-chip ${dir > 0 ? "fb-change-chip--up" : dir < 0 ? "fb-change-chip--down" : ""}`}>
              {dir > 0 ? "▲ " : dir < 0 ? "▼ " : ""}
              {text}
            </span>
          ))}
        </>
      )}
    </div>
  );
}

export { SCALES };
