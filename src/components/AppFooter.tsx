import { QuestionMarkCircleIcon } from "@heroicons/react/16/solid";

interface Props {
  version: string;
  onHelp: () => void;
  onMetronome: () => void;
  onChangelog: () => void;
}

export function AppFooter({ version, onHelp, onMetronome, onChangelog }: Props) {
  return (
    <footer className="app-footer">
      <div className="app-footer-actions">
        <button onClick={onHelp} className="btn-ghost" title="Help & tutorials">
          <QuestionMarkCircleIcon className="icon-sm" /> Help
        </button>
        <button onClick={onMetronome} className="btn-ghost" title="Open metronome">
          ♩ Metronome
        </button>
      </div>
      <button className="app-footer-version" onClick={onChangelog} title="View changelog">
        v{version}
      </button>
    </footer>
  );
}
