import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ConfettiCanvas, type ConfettiCanvasHandle } from "../session/ConfettiCanvas";
import type { AlbumBadge } from "../../api/types";

interface Props {
  badges: AlbumBadge[];
  onDismiss: () => void;
}

export function BadgeUnlockModal({ badges, onDismiss }: Props) {
  const confettiRef = useRef<ConfettiCanvasHandle>(null);

  useEffect(() => {
    confettiRef.current?.fire();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return createPortal(
    <div className="badge-unlock-overlay" onClick={onDismiss}>
      <ConfettiCanvas ref={confettiRef} />
      <div className="badge-unlock-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="badge-unlock-icon">🏅</div>
        <h3 className="badge-unlock-title">Album mastered!</h3>
        {badges.map((b) => (
          <p key={b.album_id} className="badge-unlock-album">
            <strong>{b.album_name}</strong>
            <span>{b.artist_name}{b.year ? ` · ${b.year}` : ""}</span>
          </p>
        ))}
        <button className="btn-primary" onClick={onDismiss}>Nice!</button>
      </div>
    </div>,
    document.body
  );
}
