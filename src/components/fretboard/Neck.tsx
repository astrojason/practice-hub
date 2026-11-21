import { degreeColour } from "../../lib/fretboard/schemes";
import { NUM_FRETS, degreeNumber, isAltered, plainName, type Mark } from "../../lib/fretboard/theory";

export interface NeckMark extends Mark {
  /** Ringed as a tone of the chord that is playing, with its role as a badge (R, 3, 5, b7). */
  chordtone?: boolean;
  badge?: string;
  /** The shape being strummed is drawn biggest. */
  big?: boolean;
  /** A note of the previous or next position, shown faded. */
  neighbor?: boolean;
  side?: "prev" | "next";
  /** A note on the path joining two positions. */
  link?: boolean;
  /** When two scales are blended: 0 in both, 1 only in the first, 2 only in the second. */
  source?: 0 | 1 | 2;
  /** A weak spot from the quiz, marked with a ! badge. */
  weak?: string;
  /** The note a quiz question is about. */
  quiz?: boolean;
  /** Text to show in the note instead of its degree label (quiz answers). */
  text?: string;
}

// Neck geometry (SVG units).
const FRET_W = 56;
const ZOOM = 1.7;
const STRING_GAP = 32;
const NUT_X = 54;
const TOP = 24;
const MARKER_FRETS = [3, 5, 7, 9, 15, 17, 19, 21];

interface Props {
  marks: NeckMark[];
  title: string;
  tuning: number[];
  /** Text shown inside a note (empty for none). Only notes in the position are labelled. */
  labelFor: (m: Mark) => string;
  /** Degrees ringed in gold. */
  colourLabels?: string[];
  /** The note sounding now, as "string:fret". */
  playing?: string | null;
  scheme: number;
  /** High E at the top (otherwise the low string is on top). */
  highOnTop: boolean;
  /** Give the frets of this window more room. */
  zoomWindow?: [number, number] | null;
  /** Opacity of notes outside the position, 0-1. */
  dimOpacity: number;
  onNote: (m: NeckMark) => void;
}

export function Neck({ marks, title, tuning, labelFor, colourLabels = [], playing = null, scheme, highOnTop, zoomWindow = null, dimOpacity, onNote }: Props) {
  // Fret n is the space between fret line n-1 and n; zoomed frets are wider.
  const widths = Array.from({ length: NUM_FRETS }, (_, i) => {
    const fret = i + 1;
    return zoomWindow && fret >= zoomWindow[0] && fret <= zoomWindow[1] ? FRET_W * ZOOM : FRET_W;
  });
  const lineX = [NUT_X];
  widths.forEach((w) => lineX.push(lineX[lineX.length - 1] + w));
  const width = lineX[NUM_FRETS] + FRET_W * 0.6;
  const height = TOP + 5 * STRING_GAP + 30;
  const stringY = (s: number) => TOP + (highOnTop ? 5 - s : s) * STRING_GAP;
  const noteX = (f: number) => (f === 0 ? NUT_X - 26 : (lineX[f - 1] + lineX[f]) / 2);
  const mid = TOP + 2.5 * STRING_GAP;

  return (
    <div className="fretboard-neck-wrap">
      <svg
        className={`fretboard-neck ${zoomWindow ? "fb-zoom" : ""}`}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title} on the guitar neck`}
      >
        <rect x={NUT_X} y={TOP - 10} width={lineX[NUM_FRETS] - NUT_X} height={5 * STRING_GAP + 20} className="fb-board" />
        {MARKER_FRETS.map((f) => (
          <circle key={f} cx={(lineX[f - 1] + lineX[f]) / 2} cy={mid} r={5} className="fb-inlay" />
        ))}
        {[mid - STRING_GAP, mid + STRING_GAP].map((y) => (
          <circle key={y} cx={(lineX[11] + lineX[12]) / 2} cy={y} r={5} className="fb-inlay" />
        ))}
        {lineX.map((x, f) => (
          <line key={f} x1={x} x2={x} y1={TOP - 10} y2={TOP + 5 * STRING_GAP + 10} className={f === 0 ? "fb-nut" : "fb-fret"} />
        ))}
        {tuning.map((open, s) => (
          <g key={s}>
            <line x1={NUT_X} x2={lineX[NUM_FRETS]} y1={stringY(s)} y2={stringY(s)} className="fb-string" strokeWidth={0.8 + (6 - s) * 0.35} />
            <text x={10} y={stringY(s) + 4} className="fb-open-name" data-string={s}>
              {s === 5 && open % 12 === tuning[0] % 12 ? plainName(open).toLowerCase() : plainName(open)}
            </text>
          </g>
        ))}
        {Array.from({ length: NUM_FRETS }, (_, i) => (
          <text key={i} x={(lineX[i] + lineX[i + 1]) / 2} y={height - 6} className="fb-fretnum" textAnchor="middle">{i + 1}</text>
        ))}

        {marks.map((m) => {
          const family = ((degreeNumber(m.label) - 1) % 7) + 1;
          const colour = degreeColour(scheme, family, isAltered(m.label));
          const faded = !m.inPosition;
          const classes = [
            "fb-note",
            `fb-deg-${family}`,
            isAltered(m.label) ? "fb-note--alt" : "",
            m.label === "1" ? "fb-note--root" : "",
            colourLabels.includes(m.label) ? "fb-note--colour" : "",
            faded ? "fb-note--dim" : "",
            m.neighbor ? "fb-note--neighbor" : "",
            m.side ? `fb-note--${m.side}` : "",
            m.link ? "fb-note--link" : "",
            m.source === 1 ? "fb-note--only-first" : "",
            m.source === 2 ? "fb-note--only-second" : "",
            playing === `${m.string}:${m.fret}` ? "fb-note--playing" : "",
            m.chordtone ? "fb-note--chordtone" : "",
          ].join(" ");
          const text = m.text !== undefined ? m.text : labelFor(m);
          const cx = noteX(m.fret);
          const cy = stringY(m.string);
          const r = m.big ? 15 : m.inPosition ? 12 : 8;
          const opacity = m.neighbor ? 0.55 : faded ? 1 - dimOpacity : 1;
          return (
            <g
              key={`${m.string}:${m.fret}`}
              className={classes}
              style={{ opacity }}
              data-quiz={m.quiz ?? false}
              data-in-position={m.inPosition}
              data-neighbor={m.neighbor ?? false}
              data-link={m.link ?? false}
              data-degree={m.label}
              data-string={m.string}
              data-fret={m.fret}
              data-x={cx}
              onClick={() => onNote(m)}
            >
              {m.source === 2 ? (
                <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} transform={`rotate(45 ${cx} ${cy})`} className="fb-note__dot" style={{ fill: m.quiz ? "var(--accent)" : colour.fill }} />
              ) : (
                <circle cx={cx} cy={cy} r={r} className="fb-note__dot" style={{ fill: m.quiz ? "var(--accent)" : colour.fill }} />
              )}
              {m.badge && (
                <g className="fb-note__badge">
                  <circle cx={cx + 11} cy={cy - 11} r={7} />
                  <text x={cx + 11} y={cy - 8} textAnchor="middle">{m.badge}</text>
                </g>
              )}
              {m.weak && (
                <g className="fb-note__weak" data-weak>
                  <title>{m.weak}</title>
                  <circle cx={cx - 11} cy={cy - 11} r={6} />
                  <text x={cx - 11} y={cy - 8} textAnchor="middle">!</text>
                </g>
              )}
              {text && m.inPosition && (
                <text x={cx} y={cy + 4} textAnchor="middle" className="fb-note__label" style={{ fill: m.quiz ? "#fff" : colour.text }}>{text}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
