import { useState, type ReactNode } from "react";
import { ChordFinder } from "./ChordFinder";
import { ScaleFinder } from "./ScaleFinder";
import { CircleOfFifths } from "./CircleOfFifths";
import { QuartalChords } from "./QuartalChords";

/** What every tool gets from Theory Training. */
export interface ToolProps {
  tuning: number[];
  scheme: number;
  highOnTop: boolean;
  dim: number;
  /** Run something that makes sound; a failure is shown, and the activity is logged with `detail`. */
  hear: (action: () => void, detail: string) => void;
  onError: (message: string) => void;
  /** Open a chord on the Chords page. */
  onOpenChord: (root: number, chordIdx: number) => void;
  /** Open a scale on the Scales page. */
  onOpenScale: (root: number, scaleIdx: number) => void;
}

type ToolId = "chord" | "scale" | "circle" | "quartal";

const TOOLS: { id: ToolId; label: string; blurb: string }[] = [
  { id: "chord", label: "Chord identifier", blurb: "Tap the notes you hold, get the chord's name" },
  { id: "scale", label: "Scale identifier", blurb: "Pick notes or type a song's chords, find the scale" },
  { id: "circle", label: "Circle of fifths", blurb: "Every key, its signature, modes and chords" },
  { id: "quartal", label: "Quartal chords", blurb: "Stack 4ths instead of 3rds" },
];

export function TheoryTools(props: ToolProps & { instrumentPicker: ReactNode }) {
  const [tool, setTool] = useState<ToolId>("chord");
  const { instrumentPicker, ...rest } = props;
  return (
    <div className="fb-tools" data-testid="fb-tools">
      <div className="fb-tool-tabs" role="tablist" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tool === t.id} title={t.blurb} className={`fb-tool-tab ${tool === t.id ? "active" : ""}`} onClick={() => setTool(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="fb-dim fb-tools__blurb">{TOOLS.find((t) => t.id === tool)?.blurb}</p>
      {(tool === "chord" || tool === "scale" || tool === "quartal") && instrumentPicker}
      {tool === "chord" && <ChordFinder {...rest} />}
      {tool === "scale" && <ScaleFinder {...rest} />}
      {tool === "circle" && <CircleOfFifths {...rest} />}
      {tool === "quartal" && <QuartalChords {...rest} />}
    </div>
  );
}
