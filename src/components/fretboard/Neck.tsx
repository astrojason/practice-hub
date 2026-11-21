import { NUM_FRETS, degreeNumber, isAltered, type Mark } from "../../lib/fretboard/theory";

// Neck geometry (SVG units).
const FRET_W = 56;
const STRING_GAP = 32;
const NUT_X = 44;
const TOP = 24;
const MARKER_FRETS = [3, 5, 7, 9, 15, 17, 19, 21];

interface Props {
  marks: Mark[];
  title: string;
  /** Text shown inside a note (empty for none). Only notes in the position are labelled. */
  labelFor: (m: Mark) => string;
  /** Degrees ringed in gold. */
  colourLabels?: string[];
  /** The note sounding now, as "string:fret". */
  playing?: string | null;
  onNote: (m: Mark) => void;
}

export function Neck({ marks, title, labelFor, colourLabels = [], playing = null, onNote }: Props) {
  const width = NUT_X + (NUM_FRETS + 1) * FRET_W;
  const height = TOP + 5 * STRING_GAP + 30;
  const stringY = (s: number) => TOP + (5 - s) * STRING_GAP;
  const noteX = (f: number) => (f === 0 ? NUT_X - 22 : NUT_X + (f - 0.5) * FRET_W);
  const mid = TOP + 2.5 * STRING_GAP;

  return (
    <div className="fretboard-neck-wrap">
      <svg className="fretboard-neck" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} on the guitar neck`}>
        <rect x={NUT_X} y={TOP - 10} width={NUM_FRETS * FRET_W} height={5 * STRING_GAP + 20} className="fb-board" />
        {MARKER_FRETS.map((f) => (
          <circle key={f} cx={NUT_X + (f - 0.5) * FRET_W} cy={mid} r={5} className="fb-inlay" />
        ))}
        {[mid - STRING_GAP, mid + STRING_GAP].map((y) => (
          <circle key={y} cx={NUT_X + 11.5 * FRET_W} cy={y} r={5} className="fb-inlay" />
        ))}
        {Array.from({ length: NUM_FRETS + 1 }, (_, f) => (
          <line key={f} x1={NUT_X + f * FRET_W} x2={NUT_X + f * FRET_W} y1={TOP - 10} y2={TOP + 5 * STRING_GAP + 10} className={f === 0 ? "fb-nut" : "fb-fret"} />
        ))}
        {Array.from({ length: 6 }, (_, s) => (
          <line key={s} x1={NUT_X} x2={NUT_X + NUM_FRETS * FRET_W} y1={stringY(s)} y2={stringY(s)} className="fb-string" strokeWidth={0.8 + (6 - s) * 0.35} />
        ))}
        {Array.from({ length: NUM_FRETS }, (_, i) => (
          <text key={i} x={NUT_X + (i + 0.5) * FRET_W} y={height - 6} className="fb-fretnum" textAnchor="middle">{i + 1}</text>
        ))}

        {marks.map((m) => {
          const classes = [
            "fb-note",
            `fb-deg-${((degreeNumber(m.label) - 1) % 7) + 1}`,
            isAltered(m.label) ? "fb-note--alt" : "",
            m.label === "1" ? "fb-note--root" : "",
            colourLabels.includes(m.label) ? "fb-note--colour" : "",
            m.inPosition ? "" : "fb-note--dim",
            playing === `${m.string}:${m.fret}` ? "fb-note--playing" : "",
          ].join(" ");
          const text = labelFor(m);
          return (
            <g
              key={`${m.string}:${m.fret}`}
              className={classes}
              data-in-position={m.inPosition}
              data-degree={m.label}
              data-string={m.string}
              data-fret={m.fret}
              onClick={() => onNote(m)}
            >
              <circle cx={noteX(m.fret)} cy={stringY(m.string)} r={m.inPosition ? 12 : 8} className="fb-note__dot" />
              {text && m.inPosition && (
                <text x={noteX(m.fret)} y={stringY(m.string) + 4} textAnchor="middle" className="fb-note__label">{text}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
