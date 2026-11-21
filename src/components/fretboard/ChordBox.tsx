import { degreeColour } from "../../lib/fretboard/schemes";
import { NUM_FRETS, degreeNumber, isAltered, toneFor, type Tone, type Voicing } from "../../lib/fretboard/theory";

interface Props {
  voicing: Voicing;
  /** Label for each string's note (shown under the box), lowest string first. */
  names?: string[];
  /** With these, each dot is coloured and labelled by its role in the chord. */
  tones?: Tone[];
  root?: number;
  tuning?: number[];
  scheme?: number;
  /** Click the box to strum the shape. */
  onClick?: () => void;
}

const SX = 22; // string spacing
const FY = 26; // fret spacing
const LEFT = 30;
const TOP = 30;
const ROWS = 5;

/** The fingering diagram of a chord shape: X for muted strings, O for open ones. */
export function ChordBox({ voicing, names, tones, root = 0, tuning, scheme = 0, onClick }: Props) {
  const roleOf = (s: number, f: number) => (tones && tuning ? toneFor(tones, root, tuning[s] + f) : undefined);
  const fretted = voicing.frets.filter((f): f is number => f !== null && f > 0);
  const min = fretted.length ? Math.min(...fretted) : 1;
  const max = fretted.length ? Math.max(...fretted) : 1;
  const base = max <= ROWS ? 1 : min;
  const x = (s: number) => LEFT + s * SX;
  const y = (row: number) => TOP + row * FY;
  const last = voicing.frets.length - 1;
  const width = LEFT * 2 + last * SX;
  const height = TOP + ROWS * FY + (names ? 22 : 10);

  return (
    <svg
      className="chord-box"
      viewBox={`0 0 ${width} ${height}`}
      role={onClick ? "button" : "img"}
      aria-label={onClick ? "Chord shape — click to strum" : "Chord shape"}
      onClick={onClick}
    >
      {base > 1 ? (
        <text x={LEFT - 12} y={y(0) + FY / 2 + 4} textAnchor="end" className="chord-box__base">{base}fr</text>
      ) : (
        <line x1={x(0)} x2={x(last)} y1={y(0)} y2={y(0)} className="chord-box__nut" />
      )}
      {Array.from({ length: ROWS + 1 }, (_, r) => (
        <line key={r} x1={x(0)} x2={x(last)} y1={y(r)} y2={y(r)} className="chord-box__fret" />
      ))}
      {voicing.frets.map((_, s) => (
        <line key={s} x1={x(s)} x2={x(s)} y1={y(0)} y2={y(ROWS)} className="chord-box__string" />
      ))}
      {voicing.frets.map((f, s) => {
        if (f === null) {
          return <text key={s} x={x(s)} y={TOP - 10} textAnchor="middle" className="chord-box__mute">✕</text>;
        }
        if (f === 0) return <circle key={s} cx={x(s)} cy={TOP - 14} r={5} className="chord-box__open" />;
        if (f < base || f > Math.min(NUM_FRETS, base + ROWS - 1)) return null;
        const role = roleOf(s, f);
        const fill = role ? degreeColour(scheme, ((degreeNumber(role.label) - 1) % 7) + 1, isAltered(role.label)) : null;
        return (
          <g key={s}>
            <circle cx={x(s)} cy={y(f - base) + FY / 2} r={9} className="chord-box__dot" data-string={s} data-fret={f} style={fill ? { fill: fill.fill } : undefined} />
            {role && <text x={x(s)} y={y(f - base) + FY / 2 + 3.5} textAnchor="middle" fontSize="9" fontWeight="700" fill={fill?.text}>{role.label === "1" ? "R" : role.label}</text>}
          </g>
        );
      })}
      {names?.map((n, s) => (
        <text key={s} x={x(s)} y={height - 6} textAnchor="middle" className="chord-box__name">{n}</text>
      ))}
    </svg>
  );
}
